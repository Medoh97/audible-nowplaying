// Talks to Audible's catalog and to GitHub. This runs in the content script
// rather than the service worker: workers get shut down between events, which
// made pushes unreliable, and there's nothing here that needs a worker.

(function () {
  const MIN_COMMIT_GAP_MS = 30_000;

  async function settings() {
    return chrome.storage.local.get({
      token: '',
      owner: 'Medoh97',
      repo: 'audible-nowplaying',
      branch: 'main',
      path: 'nowplaying.json',
    });
  }

  // Audible runs a separate site and API per country. Follow whichever one the
  // player is on, or a .ca listener gets .com results.
  function apiHostFor(sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname;
      return `api.${host.replace(/^(www|m)\./, '')}`;
    } catch (e) {
      return 'api.audible.com';
    }
  }

  // The page gives us a chapter and a position; this gives us everything else,
  // and it's cleaner than anything scraped out of the DOM.
  async function enrich(snap) {
    if (!snap.asin) return snap;
    const groups = 'media,product_desc,product_attrs,contributors,series';
    const url = `https://${apiHostFor(snap.source_url)}/1.0/catalog/products/${
      snap.asin
    }?response_groups=${groups}&image_sizes=500,1024`;

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
        summary:
          (p.publisher_summary || snap.summary || '').replace(/<[^>]+>/g, '').trim() || null,
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
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return null; // first ever write
    if (!res.ok) throw new Error(`read ${res.status}`);
    return (await res.json()).sha;
  }

  async function commit(snap) {
    const cfg = await settings();
    if (!cfg.token) throw new Error('no token saved');

    const body = { ...snap, updated: new Date().toISOString() };
    const json = JSON.stringify(body, null, 2) + '\n';
    const label = [body.title, body.chapter && `ch. ${body.chapter}`].filter(Boolean).join(' - ');

    const put = async (sha) =>
      fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`, {
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

    // A 409 means the file moved between our read and our write. Re-read the
    // sha and try again rather than giving up on the first collision.
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await put(await currentSha(cfg));
      if (res.status !== 409) break;
    }
    if (!res.ok) throw new Error(`write ${res.status} ${(await res.text()).slice(0, 120)}`);

    await chrome.storage.local.set({
      lastCommit: { at: new Date().toISOString(), label, ok: true },
    });
    return true;
  }

  // Returns true only if it actually pushed, so the caller knows whether to
  // keep offering the same snapshot.
  async function push(snap) {
    const { lastCommitAt = 0 } = await chrome.storage.local.get({ lastCommitAt: 0 });
    if (Date.now() - lastCommitAt < MIN_COMMIT_GAP_MS) return false;

    await chrome.storage.local.set({ lastCommitAt: Date.now() });
    try {
      await commit(await enrich(snap));
      return true;
    } catch (e) {
      await chrome.storage.local.set({
        lastCommit: { at: new Date().toISOString(), label: String(e.message), ok: false },
      });
      return false;
    }
  }

  self.NowPlayingGitHub = { push };
})();
