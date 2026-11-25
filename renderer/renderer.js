const $ = (id) => document.getElementById(id);
const log = $('log');
const input = $('q');
const app = $('app');
let busy = false;
let streaming = null; // bubble currently receiving tokens
let streamText = '';
let soundsOn = true;
const sound = (kind) => { if (soundsOn) window.echoSound?.play(kind); };

function bubble(cls, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text; // textContent only: model output is never interpreted as HTML
  log.appendChild(d);
  $('empty').hidden = true;
  log.scrollTop = log.scrollHeight;
  return d;
}

function thinking() {
  const d = bubble('bot thinking', '');
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  d.appendChild(dots);
  return d;
}

// Plain-language note of which part of Echo handled the request (never raw tool names).
const AREA = {
  set_reminder: 'Reminders', list_reminders: 'Reminders', cancel_reminder: 'Reminders',
  add_calendar_event: 'Calendar', log_expense: 'Expenses', expense_summary: 'Expenses',
  add_card: 'Cards & bills', list_bills: 'Cards & bills', mark_bill_paid: 'Cards & bills',
  remember: 'Memory', forget: 'Memory', scan_network: 'Local network',
  ha_list_entities: 'Home Assistant', ha_call_service: 'Home Assistant',
  api_search: 'Connected APIs', api_call: 'Connected APIs', make_call: 'Phone', bluetooth_devices: 'Bluetooth',
};
function addChips(el, tools) {
  const areas = [...new Set((tools || []).map((t) => AREA[t]).filter(Boolean))];
  if (!areas.length) return;
  const c = document.createElement('div');
  c.className = 'via';
  c.textContent = areas.join(' · ');
  el.appendChild(c);
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(160, input.scrollHeight) + 'px';
}

function setStatus(s) {
  if (!s) return;
  $('badge').classList.toggle('online', !s.localOnly);
  $('badgeText').textContent = s.localOnly ? `private · on-device${s.encrypted ? ' · encrypted' : ''}` : 'internet APIs allowed';
  $('model').textContent = s.model || '';
  soundsOn = s.sounds !== false;
}

async function send(text) {
  if (busy || !text) return;
  if (text === '/clear') { log.textContent = ''; $('empty').hidden = false; await window.api.clear(); return; }
  if (text === '/settings') return window.api.openSettings();
  if (text === '/privacy') return window.api.openSettings('privacy');
  bubble('user', text);
  busy = true;
  let wait = thinking();
  streaming = null;
  streamText = '';

  const onDelta = (t) => {
    if (!streaming) { wait?.remove(); wait = null; streaming = bubble('bot', ''); }
    streamText += t;
    streaming.textContent = streamText;
    log.scrollTop = log.scrollHeight;
  };
  const onReset = () => {
    if (streaming) streaming.remove();
    streaming = null;
    streamText = '';
    if (!wait) wait = thinking();
  };
  deltaHandler = onDelta;
  resetHandler = onReset;

  try {
    const res = await window.api.ask(text);
    wait?.remove();
    const el = streaming || bubble('bot', '');
    el.textContent = res.reply;
    addChips(el, res.tools);
    sound('reply');
  } catch (err) {
    wait?.remove();
    bubble('bot', 'Error: ' + err.message);
    sound('error');
  }
  streaming = null;
  deltaHandler = resetHandler = null;
  busy = false;
  input.focus();
}

let deltaHandler = null;
let resetHandler = null;
window.api.onDelta((t) => deltaHandler && deltaHandler(t));
window.api.onReset(() => resetHandler && resetHandler());
// Notification sounds come from the main process (it already checked the Sounds setting).
window.api.onSound((kind) => window.echoSound?.play(kind));

input.addEventListener('input', autoGrow);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return window.api.hide();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    autoGrow();
    send(text);
  }
});

$('suggest').addEventListener('click', (e) => {
  const q = e.target.closest('button')?.dataset.q;
  if (q) { input.value = q; autoGrow(); input.focus(); }
});
$('badge').addEventListener('click', () => window.api.openSettings('privacy'));

window.api.onFocus((info) => {
  if (info?.maxHeight) document.documentElement.style.setProperty('--log-max', Math.max(200, info.maxHeight - 190) + 'px');
  setStatus(info?.status);
  input.focus();
  input.select();
});
window.api.onStatus(setStatus);
window.api.status().then(setStatus);
new ResizeObserver(() => window.api.resize(app.getBoundingClientRect().height + 32)).observe(app);
