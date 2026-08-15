// Runs on audible.com. Reads the player, builds a snapshot, and hands it to the
// service worker whenever something actually changed. The service worker is the
// only thing that talks to GitHub.

(function () {
  // We get injected two ways (declared in the manifest, and pushed in by the
  // service worker for tabs that were already open). Only run once.
  if (window.__nowplayingLoaded) return;
  window.__nowplayingLoaded = true;

  const D = self.AudibleDom;
  const POLL_MS = 5000; // how often we look at the page
  const DRIFT_S = 60; // push a refresh if the position has moved this far

  let lastSent = null;
  let lastSentAt = 0;

  function snapshot() {
    if (!D.onPlayer()) return null;

    const asin = D.asin();
    const title = D.title();
    if (!title) return null;

    return {
      asin,
      title,
      author: D.author(),
      narrator: D.narrator(),
      series: D.series(),
      cover: D.coverUrl(),
      summary: D.summary(),
      chapter: D.chapter(),
      position_sec: D.positionSec(),
      chapter_remaining_sec: D.chapterRemainingSec(),
      book_remaining_sec: D.bookRemainingSec(),
      speed: D.speed(),
      playing: D.playing(),
      source_url: location.href,
    };
  }

  // What counts as "something happened" versus the clock just ticking.
  function meaningfulChange(next) {
    if (!lastSent) return true;
    const keys = ['asin', 'title', 'chapter', 'playing'];
    if (keys.some((k) => JSON.stringify(lastSent[k]) !== JSON.stringify(next[k]))) return true;

    const a = lastSent.position_sec;
    const b = next.position_sec;
    if (a == null || b == null) return false;
    if (Math.abs(b - a) > DRIFT_S) return true;
    return false;
  }

  // Leaves a breadcrumb the popup can show, so "nothing happened" tells you
  // which half is stuck instead of nothing at all.
  function note(why) {
    chrome.storage.local.set({
      lastScan: { at: new Date().toISOString(), why, url: location.href },
    });
  }

  function tick(force) {
    const snap = snapshot();
    if (!snap) {
      note(
        document.querySelector('audio')
          ? 'found the page but could not read a title'
          : 'no player on this page'
      );
      return;
    }
    note(`reading: ${snap.title}${snap.chapter ? ' - ' + snap.chapter : ''}`);
    if (!force && !meaningfulChange(snap)) return;

    chrome.runtime
      .sendMessage({ type: 'nowplaying', payload: snap })
      .then((res) => {
        // Only call it sent once it really went out. If the worker turned us
        // down for being too soon, leave lastSent alone and the next tick
        // offers it again.
        if (res && res.ok) {
          lastSent = snap;
          lastSentAt = Date.now();
        }
      })
      .catch(() => {});
  }

  // Catch play/pause the moment it happens instead of waiting for the poll.
  function wireAudio() {
    const a = document.querySelector('audio');
    if (!a || a.__npWired) return;
    a.__npWired = true;
    ['play', 'pause', 'ended', 'ratechange', 'loadedmetadata'].forEach((ev) =>
      a.addEventListener(ev, () => tick(true))
    );
  }

  setInterval(() => {
    wireAudio();
    tick(false);
  }, POLL_MS);

  console.log('[nowplaying] watching', location.href);
  note('content script loaded');
  wireAudio();
  setTimeout(() => tick(true), 1500);

  // The player is a single-page app, so a chapter or book change never reloads.
  new MutationObserver(() => {
    wireAudio();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
