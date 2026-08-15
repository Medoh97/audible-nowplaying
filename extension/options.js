const FIELDS = ['token', 'owner', 'repo', 'branch', 'path'];

const DEFAULTS = {
  token: '',
  owner: 'Medoh97',
  repo: 'audible-nowplaying',
  branch: 'main',
  path: 'nowplaying.json',
};

function showStatus() {
  chrome.storage.local.get({ lastCommit: null }, ({ lastCommit }) => {
    const el = document.getElementById('status');
    if (!lastCommit) {
      el.textContent = 'Nothing pushed yet. Open the Audible web player and hit play.';
      return;
    }
    const when = new Date(lastCommit.at).toLocaleTimeString();
    el.className = lastCommit.ok ? '' : 'bad';
    el.textContent = lastCommit.ok
      ? `Last push ${when}: ${lastCommit.label}`
      : `Last push failed ${when}: ${lastCommit.label}`;
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
