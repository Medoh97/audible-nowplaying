// Takes snapshots from the content script, fills in anything the page didn't
// give us, and commits the result to GitHub. Throttled so the repo history
// stays readable instead of turning into one commit per second.

const MIN_COMMIT_GAP_MS = 30_000;

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
// Audible runs a separate site and API per country. Follow whichever one the
// player is actually on, or a .ca listener gets .com results (or nothing).
function apiHostFor(sourceUrl) {
  try {
    const host = new URL(sourceUrl).hostname; // www.audible.ca
    const domain = host.replace(/^(www|m)\./, ''); // audible.ca
    return `api.${domain}`;
  } catch (e) {
    return 'api.audible.com';
  }
}

async function enrich(snap) {
  if (!snap.asin) return snap;
  const groups = 'media,product_desc,product_attrs,contributors,series';
  const host = apiHostFor(snap.source_url);
  const url = `https://${host}/1.0/catalog/products/${snap.asin}?response_groups=${groups}&image_sizes=500,1024`;

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

// No timers here on purpose. A service worker gets shut down after a few
// seconds of idle, so anything parked in a setTimeout never runs. Instead we
// either commit right now, while the worker is awake handling the message, or
// we decline and let the content script offer it again on its next tick.
async function handle(snap) {
  const { lastCommitAt = 0 } = await chrome.storage.local.get({ lastCommitAt: 0 });
  const since = Date.now() - lastCommitAt;
  if (since < MIN_COMMIT_GAP_MS) {
    return { ok: false, throttled: true, retryInMs: MIN_COMMIT_GAP_MS - since };
  }

  await chrome.storage.local.set({ lastCommitAt: Date.now() });
  try {
    await commit(await enrich(snap));
    return { ok: true };
  } catch (e) {
    await chrome.storage.local.set({
      lastCommit: { at: new Date().toISOString(), label: String(e.message), ok: false },
    });
    console.error(e);
    return { ok: false, error: String(e.message) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'nowplaying') return;
  handle(msg.payload).then(sendResponse);
  return true; // keep the message channel open for the async reply
});

// --- injection -------------------------------------------------------------
// The manifest already declares the content script, but that only covers pages
// loaded *after* the extension starts. Pushing it in ourselves means reloading
// the extension picks up the Audible tabs you already have open, and we're not
// at the mercy of when Chrome decides to register the declared script.

const AUDIBLE_TABS = [
  'https://*.audible.com/*',
  'https://*.audible.ca/*',
  'https://*.audible.co.uk/*',
  'https://*.audible.com.au/*',
  'https://*.audible.de/*',
  'https://*.audible.fr/*',
  'https://*.audible.it/*',
  'https://*.audible.es/*',
  'https://*.audible.co.jp/*',
  'https://*.audible.in/*',
];

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['selectors.js', 'content.js'],
    });
  } catch (e) {
    // Tab closed mid-flight, or a frame we're not allowed into. Not fatal.
    console.debug('inject skipped', tabId, e.message);
  }
}

async function injectAllOpenTabs() {
  // Record that the worker woke up before doing anything that can throw, so a
  // failure here shows up as a message instead of as silence.
  await chrome.storage.local.set({
    lastSweep: { at: new Date().toISOString(), count: -1, note: 'worker started' },
  });
  try {
    const tabs = await chrome.tabs.query({ url: AUDIBLE_TABS });
    await chrome.storage.local.set({
      lastSweep: { at: new Date().toISOString(), count: tabs.length },
    });
    for (const t of tabs) inject(t.id);
  } catch (e) {
    await chrome.storage.local.set({
      lastSweep: { at: new Date().toISOString(), count: -1, note: String(e.message) },
    });
  }
}

chrome.runtime.onInstalled.addListener(injectAllOpenTabs);
chrome.runtime.onStartup.addListener(injectAllOpenTabs);
injectAllOpenTabs();

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;
  if (/^https:\/\/[^/]*audible\.[a-z.]+\//.test(tab.url)) inject(tabId);
});
