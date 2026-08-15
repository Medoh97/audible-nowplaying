const FIELDS = ['token', 'owner', 'repo', 'branch', 'path'];

const DEFAULTS = {
  token: '',
  owner: 'Medoh97',
  repo: 'audible-nowplaying',
  branch: 'main',
  path: 'nowplaying.json',
};

function showStatus() {
  const keys = { lastCommit: null, lastScan: null, lastSweep: null };
  chrome.storage.local.get(keys, ({ lastCommit, lastScan, lastSweep }) => {
    const el = document.getElementById('status');
    const lines = [];

    if (lastSweep) {
      lines.push(`Found ${lastSweep.count} Audible tab(s) on last check.`);
    }

    if (lastScan) {
      const when = new Date(lastScan.at).toLocaleTimeString();
      lines.push(`Page ${when}: ${lastScan.why}`);
    } else {
      lines.push('Never saw an Audible page. Open the player and reload it.');
    }

    if (lastCommit) {
      const when = new Date(lastCommit.at).toLocaleTimeString();
      lines.push(
        lastCommit.ok
          ? `Push ${when}: ${lastCommit.label}`
          : `Push FAILED ${when}: ${lastCommit.label}`
      );
      el.className = lastCommit.ok ? '' : 'bad';
    } else {
      lines.push('Nothing pushed yet.');
      el.className = '';
    }

    el.textContent = lines.join('\n');
  });
}

chrome.storage.local.get(DEFAULTS, (s) => {
  FIELDS.forEach((f) => (document.getElementById(f).value = s[f]));
  showStatus();
});

document.getElementById('save').addEventListener('click', () => {
  const out = {};
  FIELDS.forEach((f) => (out[f] = document.getElementById(f).value.trim()));
  chrome.storage.local.set(out, () => {
    document.getElementById('status').textContent = 'Saved.';
    setTimeout(showStatus, 1200);
  });
});

setInterval(showStatus, 5000);
