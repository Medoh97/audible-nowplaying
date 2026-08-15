# Audible Now Playing

A small Chrome/Edge extension that watches the Audible web player and keeps
`nowplaying.json` in this repo up to date with whatever is currently playing.
The point is to give Resonite (or anything else that can fetch a URL) something
simple to read, so an in-world play card can show the current book, cover art,
chapter and progress.

## How it works

1. A content script runs on `audible.com` and reads the player — title, chapter,
   position, play/pause state, cover image.
2. It hands that to the extension's service worker, which fills in the cleaner
   metadata (author, narrator, series, publisher summary, full-size cover) from
   Audible's own catalog endpoint.
3. The service worker commits the result to this repo through the GitHub
   Contents API. That's a real commit — the extension can't run `git` itself.

Writes are throttled to one every 30 seconds, and only when something actually
changed: a new book, a new chapter, play/pause, or the position drifting more
than a minute from what was last published. Otherwise the history would be
thousands of useless commits.

## Setup

1. Make a fine-grained GitHub token with **Contents: read and write** on this
   repo only. Nothing else.
2. Load the extension: `chrome://extensions` → Developer mode → Load unpacked →
   pick the `extension/` folder.
3. Click the extension icon, paste the token, check the owner/repo/branch/path,
   Save.
4. Open the Audible web player and press play. The popup shows the last push.

## The JSON

```json
{
  "asin": "B00C7VNYCC",
  "title": "Betrayer: The Horus Heresy, Book 24",
  "author": "Aaron Dembski-Bowden",
  "narrator": "Jonathan Keeble",
  "series": { "name": "The Horus Heresy", "book": 24 },
  "cover": "https://m.media-amazon.com/images/I/....jpg",
  "summary": "While the Ultramarines reel from Kor Phaeron's surprise attack on Calth...",
  "chapter": "Eleven",
  "position_sec": 1221,
  "chapter_remaining_sec": 847,
  "book_remaining_sec": 28080,
  "runtime_sec": 63000,
  "speed": 1.0,
  "playing": true,
  "source_url": "https://www.audible.com/webplayer?asin=B00C7VNYCC",
  "updated": "2026-08-15T18:22:04Z"
}
```

The cover is a plain URL on Amazon's CDN — public, no login — so Resonite can
load it straight into a texture. Nothing is base64'd into the file, which keeps
the commits tiny.

## Reading it from Resonite

Fetch this and add a cache-buster so you don't get a stale copy:

```
https://raw.githubusercontent.com/Medoh97/audible-nowplaying/main/nowplaying.json?t=<random>
```

`raw.githubusercontent.com` caches for around five minutes. If that's too slow,
hit the API version instead, which serves fresh:

```
https://api.github.com/repos/Medoh97/audible-nowplaying/contents/nowplaying.json
Accept: application/vnd.github.raw
```

## Heads up

This repo is public, so the file is a live, world-readable log of what you're
listening to and how far in you are. That's fine for a play card — just know
it's out there.

The bits that read the player's DOM all live in
[`extension/selectors.js`](extension/selectors.js). Audible will redesign the
player eventually and break them. When that happens, that's the only file that
should need fixing.
