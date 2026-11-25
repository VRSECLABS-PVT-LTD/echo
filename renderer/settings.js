const $ = (id) => document.getElementById(id);
let cfg = null;
let items = [];
let editing = null;
let msgTimer = null;

function msg(text, ok) {
  const m = $('msg');
  m.textContent = text;
  m.className = (ok ? 'ok' : 'err') + ' show';
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.classList.remove('show'), 3500);
}

// Every IPC call returns {data} or {error}.
async function call(p) {
  const r = await p;
  if (r.error) { msg(r.error, false); return null; }
  return r;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- general ----------
async function loadGeneral() {
  const r = await call(window.sapi.getConfig());
  if (!r) return;
  cfg = r.data;
  const models = (await call(window.sapi.models()))?.data || [];
  const sel = $('model');
  sel.textContent = '';
  for (const m of new Set([cfg.model, ...models])) {
    const o = el('option', null, m + (models.includes(m) ? '' : ' (not installed)'));
    o.value = m;
    sel.appendChild(o);
  }
  sel.value = cfg.model;
  $('hotkey').value = cfg.hotkey;
  $('currency').value = cfg.currency;
  $('calendarName').value = cfg.calendarName || '';
  $('calWrap').hidden = cfg.platform !== 'darwin';
  $('localOnly').checked = cfg.localOnly;
  $('saveHistory').checked = cfg.saveHistory;
  $('sounds').checked = cfg.sounds !== false;
  $('haUrl').value = cfg.haUrl || '';
  $('haToken').placeholder = cfg.haHasToken ? '•••••••• saved (leave blank to keep)' : 'paste a long-lived access token';
  $('dataDir').textContent = `Stored only on this computer, in ${cfg.dataDir}`;
  $('version').textContent = 'v' + cfg.version;
  if (cfg.supportEmail) $('supportEmail').textContent = cfg.supportEmail;
  renderPrivacy();
  $('callsNote').textContent = {
    darwin: 'Calls go through your iPhone using Continuity (FaceTime). Your iPhone must use the same Apple ID, be nearby, and have "Calls on Other Devices" turned on. Echo can also look up names in Contacts.',
    win32: 'Calls go through Phone Link (or your default calling app). Pair your phone in Phone Link first.',
    linux: 'Calls open your default tel: handler, such as KDE Connect or GNOME Calls.',
  }[cfg.platform] || '';
}

function renderPrivacy() {
  const e = cfg.encryption;
  const card = $('encCard');
  card.textContent = '';
  card.className = 'card status-card' + (!e.enabled ? ' off' : e.weak ? ' weak' : '');
  const body = el('div');
  body.appendChild(el('div', 't', !e.enabled ? 'Encryption is unavailable' : e.weak ? 'Encrypted, but with weak key protection' : 'Your data is encrypted at rest'));
  body.appendChild(el('div', 'note', !e.enabled
    ? 'Your system has no keychain Echo can use, so data is stored unencrypted (still readable only by your user account).'
    : e.weak
      ? 'No system keyring (GNOME Keyring / KWallet) was found, so the encryption key is only obfuscated. Install and unlock a keyring for full protection.'
      : `AES-256-GCM on every file. The key is protected by ${e.backend}.`));
  card.append(el('span', 'dot'), body);
  const pill = $('privPill');
  pill.textContent = cfg.localOnly ? 'Local-only' : 'Internet APIs allowed';
  pill.classList.toggle('online', !cfg.localOnly);
}

$('saveGeneral').onclick = async () => {
  const r = await call(window.sapi.setConfig({ model: $('model').value, hotkey: $('hotkey').value.trim(), currency: $('currency').value, calendarName: $('calendarName').value }));
  if (r) { cfg = r.data; msg('Saved.', true); }
};
$('rerunSetup').onclick = () => window.sapi.rerunSetup();
$('sounds').onchange = async (e) => {
  const r = await call(window.sapi.setConfig({ sounds: e.target.checked }));
  if (r) { cfg = r.data; msg('Saved.', true); if (cfg.sounds) window.echoSound?.play('reply'); } else loadGeneral();
};
$('soundPreview').addEventListener('click', (e) => {
  const kind = e.target.closest('button')?.dataset.sound;
  if (kind) window.echoSound?.play(kind);
});

// ---------- privacy ----------
async function toggleSetting(key, value) {
  const r = await call(window.sapi.setConfig({ [key]: value }));
  if (r) { cfg = r.data; renderPrivacy(); msg('Saved.', true); } else loadGeneral();
}
$('localOnly').onchange = (e) => {
  if (!e.target.checked && !confirm('Allow Echo to call API integrations on internet hosts?\n\nOnly APIs you add yourself can be reached, and every external request is logged.')) { e.target.checked = true; return; }
  toggleSetting('localOnly', e.target.checked);
};
$('saveHistory').onchange = (e) => toggleSetting('saveHistory', e.target.checked);

async function loadNetlog() {
  const rows = (await call(window.sapi.netlog()))?.data || [];
  const tb = $('netlog');
  tb.textContent = '';
  $('netlogEmpty').hidden = rows.length > 0;
  tb.parentElement.hidden = rows.length === 0;
  for (const r of rows.slice(0, 100)) {
    const tr = el('tr');
    tr.append(el('td', null, new Date(r.t).toLocaleString()), el('td', null, r.purpose), el('td', 'mono', r.host), el('td', 'mono', String(r.status ?? r.method ?? '')));
    tb.appendChild(tr);
  }
}
$('clearLog').onclick = async () => { if (await call(window.sapi.clearNetlog())) loadNetlog(); };
$('openData').onclick = () => window.sapi.openData();
$('wipe').onclick = () => window.sapi.wipe();

// ---------- Home Assistant ----------
$('saveHa').onclick = async () => {
  const r = await call(window.sapi.setConfig({ haUrl: $('haUrl').value, haToken: $('haToken').value }));
  if (r) { cfg = r.data; $('haToken').value = ''; loadGeneral(); msg('Home Assistant saved.', true); }
};
$('clearHa').onclick = async () => { if (await call(window.sapi.setConfig({ clearHaToken: true }))) { loadGeneral(); msg('Token removed.', true); } };

// ---------- API integrations ----------
function render() {
  const list = $('list');
  list.textContent = '';
  if (!items.length) list.appendChild(el('p', 'note', 'No APIs connected yet.'));
  for (const it of items) {
    const row = el('div', 'item');
    const meta = el('div', 'meta');
    const name = el('div', 'name', it.name);
    if (it.local === true) name.appendChild(el('span', 'tag local', 'local network'));
    else if (it.local === false) name.appendChild(el('span', 'tag ext', 'internet host'));
    if (it.hasToken) name.appendChild(el('span', 'tag tok', 'token saved'));
    meta.appendChild(name);
    meta.appendChild(el('div', 'sub2', `${it.baseUrl || 'no base URL set'} · ${it.opCount} operations`));
    const edit = el('button', 'ghost', 'Edit');
    edit.onclick = () => openEditor(it);
    const del = el('button', 'danger', 'Remove');
    del.onclick = async () => {
      if (!confirm(`Remove "${it.name}" and its saved token?`)) return;
      if (await call(window.sapi.remove(it.id))) { if (editing === it.id) $('editor').hidden = true; await refresh(); msg('Removed.', true); }
    };
    row.append(meta, edit, del);
    list.appendChild(row);
  }
}

function syncAuthUi() {
  const t = $('edAuth').value;
  $('edAuthNameWrap').hidden = !(t === 'header' || t === 'query');
  $('edAuthName').placeholder = t === 'query' ? 'api_key' : 'X-API-Key';
}

function syncWarn() {
  const u = $('edUrl').value.trim();
  const local = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/:]+\.local)/i.test(u);
  $('edWarn').textContent = !u ? 'Set a base URL before Echo can call this API.'
    : local ? '' : `Internet host: requests (including what you ask) are sent to this server.${cfg?.localOnly ? ' Blocked while local-only mode is on.' : ''}`;
}

function openEditor(it) {
  editing = it.id;
  $('edTitle').textContent = `Edit · ${it.name}`;
  $('edName').value = it.name;
  $('edUrl').value = it.baseUrl || '';
  $('edAuth').value = it.authType || 'none';
  $('edAuthName').value = it.authName || '';
  $('edToken').value = '';
  $('edClear').hidden = !it.hasToken;
  syncAuthUi();
  syncWarn();
  $('editor').hidden = false;
  $('editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function refresh() {
  items = (await call(window.sapi.list()))?.data || [];
  render();
}

async function saveIntegration(extra = {}) {
  const r = await call(window.sapi.update({
    id: editing, name: $('edName').value, baseUrl: $('edUrl').value, authType: $('edAuth').value,
    authName: $('edAuthName').value, token: $('edToken').value, ...extra,
  }));
  if (!r) return;
  $('edToken').value = '';
  await refresh();
  openEditor(r.data);
  msg('Saved.', true);
}

$('edAuth').onchange = syncAuthUi;
$('edUrl').oninput = syncWarn;
$('edSave').onclick = () => saveIntegration();
$('edClear').onclick = () => saveIntegration({ clearToken: true, token: '' });
$('edCancel').onclick = () => { $('editor').hidden = true; editing = null; };

async function afterImport(r) {
  if (!r || !r.data) return; // null = file dialog cancelled
  $('newName').value = '';
  $('newSpec').value = '';
  await refresh();
  openEditor(r.data);
  msg(`Imported ${r.data.opCount} operations. Now confirm the base URL and add your token.`, true);
}
$('importPaste').onclick = async () => afterImport(await call(window.sapi.importText($('newName').value, $('newSpec').value)));
$('importFile').onclick = async () => afterImport(await call(window.sapi.importFile($('newName').value)));

// ---------- about ----------
$('openSite').onclick = () => window.sapi.openSite();
$('openReport').onclick = () => window.sapi.openReport();

// ---------- nav ----------
function goto(id) { const s = document.getElementById(id); if (s) s.scrollIntoView({ behavior: 'smooth' }); }
window.sapi.onGoto((s) => { goto(s); if (s === 'privacy') loadNetlog(); });
const navLinks = [...document.querySelectorAll('nav a')];
const spy = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle('on', a.hash === '#' + en.target.id));
}, { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('main section').forEach((s) => spy.observe(s));
window.addEventListener('focus', loadNetlog);

(async () => {
  await loadGeneral();
  await refresh();
  await loadNetlog();
  if (location.hash) goto(location.hash.slice(1));
})();
