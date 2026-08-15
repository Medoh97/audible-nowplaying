const FIELDS = ['token', 'owner', 'repo', 'branch', 'path'];

const DEFAULTS = {
  token: '',
  owner: '',
  repo: '',
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

// Says what is actually in storage, which is not always what the box shows —
// the browser likes to autofill this field with an old saved password.
function showTokenState() {
  chrome.storage.local.get({ token: '' }, ({ token }) => {
    const el = document.getElementById('tokenState');
    if (!token) {
      el.textContent = 'Not saved. Paste the token and press Save.';
      el.style.color = '#ff6b6b';
    } else {
      el.textContent = `Saved: ${token.slice(0, 11)}... (${token.length} characters)`;
      el.style.color = '#26822c';
    }
  });
}

chrome.storage.local.get(DEFAULTS, (s) => {
  FIELDS.forEach((f) => (document.getElementById(f).value = s[f]));
  showTokenState();
  showStatus();
});

document.getElementById('save').addEventListener('click', () => {
  const out = {};
  FIELDS.forEach((f) => (out[f] = document.getElementById(f).value.trim()));

  // Refuse to wipe a working token just because the box happened to be empty.
  if (!out.token) {
    const el = document.getElementById('tokenState');
    el.textContent = 'Token box is empty - paste it in before saving.';
    el.style.color = '#ff6b6b';
    return;
  }

  chrome.storage.local.set(out, () => {
    document.getElementById('status').textContent = 'Saved.';
    showTokenState();
    setTimeout(showStatus, 1200);
  });
});

setInterval(showStatus, 5000);
