// Everything in this file is the part that Audible will eventually break.
// When the player stops reporting, this is the only file you should need to touch.
// Each getter tries a list of candidate selectors, then falls back to reading
// the page text, so a class rename doesn't take the whole thing down.

(function () {
  const first = (selectors, root = document) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const text = (el) => (el && el.textContent ? el.textContent.trim() : null);

  // "20:21" -> 1221, "1:04:07" -> 3847, "-14:07" -> 847
  const clockToSeconds = (raw) => {
    if (!raw) return null;
    const m = raw.match(/(\d+:)?\d{1,2}:\d{2}/);
    if (!m) return null;
    const parts = m[0].split(':').map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  };

  // "7h 48m left" -> 28080, "48 mins left" -> 2880
  const wordyToSeconds = (raw) => {
    if (!raw) return null;
    const h = raw.match(/(\d+)\s*h/i);
    const mm = raw.match(/(\d+)\s*m/i);
    if (!h && !mm) return null;
    return (h ? +h[1] * 3600 : 0) + (mm ? +mm[1] * 60 : 0);
  };

  // Anything on the page that looks like "7h 48m left".
  const scanForRemaining = () => {
    const nodes = document.querySelectorAll('span, div, p');
    for (const n of nodes) {
      const t = n.textContent && n.textContent.trim();
      if (t && t.length < 40 && /left|remaining/i.test(t) && /\d/.test(t)) {
        const secs = wordyToSeconds(t) ?? clockToSeconds(t);
        if (secs) return secs;
      }
    }
    return null;
  };

  const audioEl = () => document.querySelector('audio');

  const AudibleDom = {
    clockToSeconds,
    wordyToSeconds,

    // Pulled from the URL first (the player puts it there), then from any
    // product link, then from the cover image filename.
    asin() {
      const url = new URL(location.href);
      const q =
        url.searchParams.get('asin') ||
        url.searchParams.get('contentDeliveryType') === null
          ? url.searchParams.get('asin')
          : null;
      if (q && /^[A-Z0-9]{10}$/.test(q)) return q;

      const path = location.pathname.match(/\/pd\/[^/]*\/([A-Z0-9]{10})/);
      if (path) return path[1];

      const link = document.querySelector('a[href*="/pd/"]');
      if (link) {
        const m = link.getAttribute('href').match(/([A-Z0-9]{10})/);
        if (m) return m[1];
      }

      const cover = this.coverUrl();
      if (cover) {
        const m = cover.match(/\/([A-Z0-9]{10})\./);
        if (m) return m[1];
      }
      return null;
    },

    coverUrl() {
      const el = first([
        'adbl-player img',
        '.adblPlayerCoverArt img',
        'img[alt*="cover" i]',
        'img[src*="m.media-amazon.com"]',
        'img[src*="images-amazon"]',
      ]);
      if (!el) return null;
      const src = el.getAttribute('src') || el.getAttribute('data-src');
      if (!src) return null;
      // Ask the CDN for a bigger version than the player thumbnail.
      return src.replace(/\._[^.]+_\./, '._SL500_.');
    },

    title() {
      return (
        text(
          first([
            'adbl-player [slot="title"]',
            '.adblPlayerTitle',
            'h1.bc-heading',
            'h1',
          ])
        ) || document.title.replace(/\s*\|\s*Audible.*$/i, '').trim() || null
      );
    },

    author() {
      return text(first(['a[href*="/author/"]', '.authorLabel a', 'li.authorLabel a']));
    },

    narrator() {
      return text(first(['a[href*="/search?searchNarrator"]', '.narratorLabel a', 'li.narratorLabel a']));
    },

    series() {
      const link = first(['a[href*="/series/"]', '.seriesLabel a']);
      if (!link) return null;
      const label = first(['.seriesLabel', 'li.seriesLabel']);
      const bookNum = label && label.textContent.match(/Book\s+(\d+)/i);
      return { name: text(link), book: bookNum ? +bookNum[1] : null };
    },

    summary() {
      const el = first([
        '.productPublisherSummary p',
        '[class*="PublisherSummary"] p',
        'meta[name="description"]',
      ]);
      if (!el) return null;
      return el.tagName === 'META' ? el.getAttribute('content') : text(el);
    },

    chapter() {
      const t = text(
        first([
          'adbl-chapter-title',
          '.adblPlayerChapterTitle',
          '[class*="chapterTitle" i]',
          '[data-testid*="chapter" i]',
        ])
      );
      // The player shows a bare chapter name with nothing else around it.
      if (t && t.length < 80) return t;
      return null;
    },

    speed() {
      const t = text(first(['[class*="speed" i]', '[data-testid*="speed" i]']));
      const m = t && t.match(/([\d.]+)\s*x/i);
      if (m) return parseFloat(m[1]);
      const a = audioEl();
      return a ? a.playbackRate : null;
    },

    playing() {
      const a = audioEl();
      if (a) return !a.paused;
      const btn = first(['button[aria-label*="Pause" i]', '[data-testid="pause"]']);
      return !!btn;
    },

    // Seconds into the current chapter.
    positionSec() {
      const a = audioEl();
      if (a && Number.isFinite(a.currentTime) && a.currentTime > 0) {
        return Math.round(a.currentTime);
      }
      const el = first(['[class*="elapsed" i]', '[data-testid*="elapsed" i]']);
      return clockToSeconds(text(el));
    },

    chapterRemainingSec() {
      const a = audioEl();
      if (a && Number.isFinite(a.duration) && a.duration > 0) {
        return Math.round(a.duration - a.currentTime);
      }
      const el = first(['[class*="remaining" i]', '[data-testid*="remaining" i]']);
      const t = text(el);
      return t && t.startsWith('-') ? clockToSeconds(t) : clockToSeconds(t);
    },

    bookRemainingSec() {
      return scanForRemaining();
    },

    onPlayer() {
      return /webplayer|\/pd\//i.test(location.href) || !!audioEl();
    },
  };

  self.AudibleDom = AudibleDom;
})();
