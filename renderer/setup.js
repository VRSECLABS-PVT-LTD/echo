const $ = (id) => document.getElementById(id);
const STEPS = ['welcome', 'engine', 'model', 'install', 'done'];
let info = null;
let chosen = null;
let poll = null;

const unwrap = async (p) => { const r = await p; if (r.error) throw new Error(r.error); return r.data; };

function show(step) {
  STEPS.forEach((s) => ($(s).hidden = s !== step));
  const idx = STEPS.indexOf(step);
  [...$('stepDots').children].forEach((d, i) => d.classList.toggle('on', i <= idx));
  $('orbWrap').classList.toggle('busy', step === 'install' || step === 'engine');
}

// ---------- rotating trust slides ----------
const slides = [...$('slides').children];
slides.forEach(() => $('slideDots').appendChild(document.createElement('i')));
let slide = 0;
function setSlide(i) {
  slide = (i + slides.length) % slides.length;
  slides.forEach((s, k) => s.classList.toggle('on', k === slide));
  [...$('slideDots').children].forEach((d, k) => d.classList.toggle('on', k === slide));
}
setSlide(0);
setInterval(() => setSlide(slide + 1), 4500);

$('siteLink').onclick = () => window.setup.openSite();

// ---------- hotkey display ----------
function keyCaps(accel) {
  const mac = info?.platform === 'darwin';
  const map = { Alt: mac ? '⌥' : 'Alt', Option: '⌥', Control: mac ? '⌃' : 'Ctrl', Ctrl: mac ? '⌃' : 'Ctrl', Shift: mac ? '⇧' : 'Shift',
    Command: '⌘', Cmd: '⌘', CommandOrControl: mac ? '⌘' : 'Ctrl', CmdOrCtrl: mac ? '⌘' : 'Ctrl', Super: 'Win', Space: 'Space' };
  return String(accel || '').split('+').map((k) => map[k] || k);
}

// ---------- step 1: engine ----------
async function checkEngine() {
  const s = await unwrap(window.setup.check());
  if (s.running) {
    clearInterval(poll); poll = null;
    $('engineStatus').classList.add('ok');
    $('engineText').textContent = 'Ollama is running on this computer.';
    $('engineMissing').hidden = true;
    $('engineNext').hidden = false;
    info.ollama = s;
    return true;
  }
  $('engineMissing').hidden = false;
  $('engineText').textContent = s.installed ? 'Ollama is installed but not running yet. Starting it…' : 'Ollama isn\'t installed yet.';
  const p = info.platform;
  $('linuxCmd').hidden = p !== 'linux';
  $('engineHelp').textContent = s.installed
    ? 'Open the Ollama app once (or run "ollama serve"), then Echo will continue.'
    : p === 'linux'
      ? 'Install it with the official one-line script below (it asks for your password), or use the download page.'
      : `Download the official installer for ${p === 'darwin' ? 'macOS' : 'Windows'}, run it, and come back here.`;
  if (!poll) poll = setInterval(checkEngine, 2500);
  return false;
}
$('downloadBtn').onclick = () => window.setup.openDownload();
$('retryBtn').onclick = () => checkEngine();
$('copyCmd').onclick = async () => { await window.setup.copy('curl -fsSL https://ollama.com/install.sh | sh'); $('copyCmd').textContent = 'Copied'; };
$('engineContinue').onclick = () => { renderModels(); show('model'); };

// ---------- step 2: model ----------
function renderModels() {
  $('machine').textContent = `This computer has ${info.ramGB} GB of memory${info.cpu ? ' · ' + info.cpu.trim() : ''}. We recommend the highlighted model.`;
  const have = info.ollama.models || [];
  chosen = chosen || (have.includes(info.recommended) ? info.recommended : info.recommended);
  $('cards').textContent = '';
  for (const m of info.models) {
    const b = document.createElement('button');
    b.className = 'card' + (m.id === chosen ? ' sel' : '');
    const radio = document.createElement('span'); radio.className = 'radio';
    const body = document.createElement('div');
    const t = document.createElement('div'); t.className = 't'; t.textContent = m.name;
    const tags = [];
    if (m.id === info.recommended) tags.push(['rec', 'Recommended']);
    if (have.includes(m.id)) tags.push(['have', 'Installed']);
    if (info.ramGB < m.minRam) tags.push(['slow', 'May be slow here']);
    for (const [cls, label] of tags) { const s = document.createElement('span'); s.className = 'tag ' + cls; s.textContent = label; t.appendChild(s); }
    const bl = document.createElement('div'); bl.className = 'b'; bl.textContent = `${m.base} · ${m.size} download`;
    const d = document.createElement('div'); d.className = 'd'; d.textContent = m.blurb;
    body.append(t, bl, d);
    b.append(radio, body);
    b.onclick = () => { chosen = m.id; renderModels(); };
    $('cards').appendChild(b);
  }
  $('installBtn').textContent = have.includes(chosen) ? 'Use this model' : 'Download & install';
}
$('installBtn').onclick = () => install();

// ---------- step 3: install ----------
const fmtBytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
function phase(name) {
  const order = ['manifest', 'download', 'verify', 'write', 'warm'];
  const idx = order.indexOf(name);
  [...$('phases').children].forEach((li, i) => {
    li.classList.toggle('done', i < idx);
    li.classList.toggle('active', i === idx);
  });
}

async function install() {
  show('install');
  $('installErr').hidden = true;
  $('installRetry').hidden = true;
  const already = (info.ollama.models || []).includes(chosen);
  const layers = {};
  let lastBytes = 0, lastT = Date.now();

  if (already) {
    $('installTitle').textContent = 'Model already installed';
    $('fill').style.width = '100%';
    $('pct').textContent = '100%';
  } else {
    phase('manifest');
    window.setup.onProgress((p) => {
      const st = String(p.status || '');
      if (st.startsWith('pulling manifest')) phase('manifest');
      else if (p.digest && p.total) {
        phase('download');
        layers[p.digest] = { total: p.total, completed: p.completed || 0 };
        const total = Object.values(layers).reduce((s, l) => s + l.total, 0);
        const done = Object.values(layers).reduce((s, l) => s + l.completed, 0);
        const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 0;
        $('fill').style.width = pct + '%';
        $('pct').textContent = pct + '%';
        $('bytes').textContent = `${fmtBytes(done)} of ${fmtBytes(total)}`;
        const now = Date.now();
        if (now - lastT > 800) {
          $('speed').textContent = `${fmtBytes(Math.max(0, (done - lastBytes) / ((now - lastT) / 1000)))}/s`;
          lastBytes = done; lastT = now;
        }
      } else if (st.startsWith('verifying')) { phase('verify'); $('speed').textContent = ''; }
      else if (st.startsWith('writing') || st === 'success') { phase('write'); $('fill').style.width = '100%'; $('pct').textContent = '100%'; }
    });
    try {
      await unwrap(window.setup.pull(chosen));
    } catch (e) {
      $('installErr').textContent = `Download failed: ${e.message}. Check your connection and try again.`;
      $('installErr').hidden = false;
      $('installRetry').hidden = false;
      return;
    }
  }
  phase('warm');
  $('installTitle').textContent = 'Optimizing for instant replies';
  $('installSub').textContent = 'Loading the model into memory so Echo answers in milliseconds.';
  await unwrap(window.setup.finish(chosen)).catch(() => {});
  phase('done-all');
  [...$('phases').children].forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
  setTimeout(() => { renderDone(); show('done'); }, 600);
}
$('retryInstall').onclick = () => install();

// ---------- done ----------
function renderDone() {
  $('keys').textContent = '';
  for (const k of keyCaps(info.hotkey)) { const s = document.createElement('span'); s.textContent = k; $('keys').appendChild(s); }
}
$('finishBtn').onclick = () => window.setup.close();

// ---------- boot ----------
$('startBtn').onclick = async () => { show('engine'); await checkEngine(); };
(async () => {
  show('welcome');
  info = await unwrap(window.setup.info());
  $('hotkeyWelcome').textContent = keyCaps(info.hotkey).join(' ');
})();
