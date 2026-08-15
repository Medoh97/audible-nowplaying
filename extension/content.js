// Runs on audible.com. Reads the player, builds a snapshot, and hands it to the
// service worker whenever something actually changed. The service worker is the
// only thing that talks to GitHub.

(function () {
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

  function tick(force) {
    const snap = snapshot();
    if (!snap) return;
    if (!force && !meaningfulChange(snap)) return;

    lastSent = snap;
    lastSentAt = Date.now();
    chrome.runtime.sendMessage({ type: 'nowplaying', payload: snap }).catch(() => {});
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

  wireAudio();
  setTimeout(() => tick(true), 1500);

  // The player is a single-page app, so a chapter or book change never reloads.
  new MutationObserver(() => {
    wireAudio();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
