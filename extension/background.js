// Takes snapshots from the content script, fills in anything the page didn't
// give us, and commits the result to GitHub. Throttled so the repo history
// stays readable instead of turning into one commit per second.

const MIN_COMMIT_GAP_MS = 30_000;

let lastCommitAt = 0;
let pending = null;
let timer = null;

async function settings() {
  const s = await chrome.storage.local.get({
    token: '',
    owner: 'Medoh97',
    repo: 'audible-nowplaying',
    branch: 'main',
    path: 'nowplaying.json',
  });
  return s;
}

// Audible's own catalog endpoint. No login needed for the basic fields, and it
// gives cleaner data than scraping a product page, so we prefer it when it works.
async function enrich(snap) {
  if (!snap.asin) return snap;
  const groups = 'media,product_desc,product_attrs,contributors,series';
  const url = `https://api.audible.com/1.0/catalog/products/${snap.asin}?response_groups=${groups}&image_sizes=500,1024`;

  try {
    const res = await fetch(url);
    if (!res.ok) return snap;
    const p = (await res.json()).product;
    if (!p) return snap;

    const authors = (p.authors || []).map((a) => a.name).filter(Boolean);
    const narrators = (p.narrators || []).map((n) => n.name).filter(Boolean);
    const series = (p.series || [])[0];
    const images = p.product_images || {};

    return {
      ...snap,
      title: p.title || snap.title,
      subtitle: p.subtitle || null,
      author: authors.join(', ') || snap.author,
      narrator: narrators.join(', ') || snap.narrator,
      series: series
        ? { name: series.title, book: series.sequence ? Number(series.sequence) : null }
        : snap.series,
      cover: images['1024'] || images['500'] || snap.cover,
      summary: (p.publisher_summary || snap.summary || '')
        .replace(/<[^>]+>/g, '')
        .trim() || null,
      runtime_sec: p.runtime_length_min ? p.runtime_length_min * 60 : null,
      release_date: p.release_date || null,
    };
  } catch (e) {
    return snap;
  }
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function currentSha(cfg) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${cfg.branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return null; // first ever write
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  return (await res.json()).sha;
}

async function commit(snap) {
  const cfg = await settings();
  if (!cfg.token) throw new Error('No GitHub token set. Open the extension options.');

  const body = { ...snap, updated: new Date().toISOString() };
  const json = JSON.stringify(body, null, 2) + '\n';

  const label = [body.title, body.chapter && `ch. ${body.chapter}`]
    .filter(Boolean)
    .join(' - ');

  const put = async (sha) => {
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
    return fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `now playing: ${label}`,
        content: toBase64(json),
        branch: cfg.branch,
        ...(sha ? { sha } : {}),
      }),
    });
  };

  let res = await put(await currentSha(cfg));
  if (res.status === 409) {
    // Someone (or a slow earlier write) moved the file under us. Re-read and retry once.
    res = await put(await currentSha(cfg));
  }
  if (!res.ok) throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);

  await chrome.storage.local.set({
    lastCommit: { at: new Date().toISOString(), label, ok: true },
  });
}

async function flush() {
  timer = null;
  if (!pending) return;
  const snap = pending;
  pending = null;
  lastCommitAt = Date.now();

  try {
    await commit(await enrich(snap));
  } catch (e) {
    await chrome.storage.local.set({
      lastCommit: { at: new Date().toISOString(), label: String(e.message), ok: false },
    });
    console.error(e);
  }
}

function schedule(snap) {
  pending = snap;
  if (timer) return;
  const wait = Math.max(0, MIN_COMMIT_GAP_MS - (Date.now() - lastCommitAt));
  timer = setTimeout(flush, wait);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'nowplaying') schedule(msg.payload);
});
