// Agent tools. Every tool runs locally and returns a small JSON-able result.
const store = require('./store');
const integrations = require('./integrations');
const platform = require('./platform');
const { isLocalHost } = integrations;

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (d) => `${dateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// "YYYY-MM-DD HH:MM" (local time). Date only => 09:00.
function parseLocal(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], m[2] - 1, +m[3], +(m[4] ?? 9), +(m[5] ?? 0));
  return isNaN(d) ? null : d;
}

function advance(d, repeat) {
  const n = new Date(d);
  if (repeat === 'daily') n.setDate(n.getDate() + 1);
  else if (repeat === 'weekly') n.setDate(n.getDate() + 7);
  else if (repeat === 'monthly') n.setMonth(n.getMonth() + 1);
  else return null;
  return n;
}

// ---- credit card due-date helpers (shared with scheduler) ----
function dueDate(card, year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(card.due_day, last));
}
function nextDue(card, now = new Date()) {
  const t = startOfDay(now);
  let d = dueDate(card, t.getFullYear(), t.getMonth());
  if (d < t) d = dueDate(card, t.getFullYear(), t.getMonth() + 1);
  return d;
}
function prevDue(card, now = new Date()) {
  const t = startOfDay(now);
  let d = dueDate(card, t.getFullYear(), t.getMonth());
  if (d >= t) d = dueDate(card, t.getFullYear(), t.getMonth() - 1);
  return d;
}
const sameCard = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const outstanding = (card) =>
  store.get('expenses')
    .filter((e) => e.kind === 'credit' && !e.settled && sameCard(e.card, card.name))
    .reduce((s, e) => s + e.amount, 0);

// ---- network discovery ----
async function scanNetwork() {
  await platform.pingSweep();
  const devices = await platform.neighbours();
  const services = [];
  try {
    const { Bonjour } = require('bonjour-service');
    const bj = new Bonjour();
    const types = ['hap', 'googlecast', 'airplay', 'hue', 'matter', 'homeassistant', 'esphomelib', 'ipp'];
    const browsers = types.map((t) =>
      bj.find({ type: t }, (s) =>
        services.push({ type: t, name: s.name, host: s.host, ip: (s.addresses || []).find((a) => /^\d+\./.test(a)), port: s.port })));
    await new Promise((r) => setTimeout(r, 4000));
    browsers.forEach((b) => b.stop());
    bj.destroy();
  } catch (e) {
    services.push({ error: 'mDNS discovery failed: ' + e.message });
  }
  return { device_count: devices.length, devices: devices.slice(0, 40), smart_services: services.slice(0, 40) };
}

async function haFetch(pathname, opts = {}) {
  const { url, token } = store.get('config').homeAssistant || {};
  if (!url || !token) throw new Error('Home Assistant is not set up. Add its URL and token in Settings → Integrations.');
  if (!isLocalHost(url)) throw new Error('Home Assistant must be on your local network (privacy rule).');
  const r = await fetch(url.replace(/\/$/, '') + pathname, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Home Assistant returned ${r.status}`);
  return r.json();
}

// ---- tool implementations ----
const impl = {
  set_reminder(a) {
    const when = a.in_minutes != null && a.in_minutes !== '' ? new Date(Date.now() + Number(a.in_minutes) * 60000) : parseLocal(a.at);
    if (!when || isNaN(when)) return { error: 'Give in_minutes, or at as "YYYY-MM-DD HH:MM" (24h local time).' };
    if (when < Date.now() - 60000) return { error: 'That time is in the past.' };
    const repeat = ['daily', 'weekly', 'monthly'].includes(a.repeat) ? a.repeat : 'none';
    const r = { id: store.id(), text: String(a.text || 'Reminder').slice(0, 200), at: when.toISOString(), repeat };
    store.get('reminders').push(r);
    store.save('reminders');
    return { ok: true, id: r.id, text: r.text, when: fmt(when), repeat };
  },

  list_reminders() {
    const list = store.get('reminders').map((r) => ({ id: r.id, text: r.text, when: fmt(new Date(r.at)), repeat: r.repeat }));
    return list.length ? list : { reminders: [], note: 'No pending reminders.' };
  },

  cancel_reminder(a) {
    const list = store.get('reminders');
    const q = String(a.id_or_text || '').toLowerCase();
    const i = list.findIndex((r) => r.id === q || r.text.toLowerCase().includes(q));
    if (!q || i < 0) return { error: 'No matching reminder.' };
    const [gone] = list.splice(i, 1);
    store.save('reminders');
    return { ok: true, cancelled: gone.text };
  },

  async add_calendar_event(a, ctx) {
    const start = parseLocal(a.start);
    if (!start) return { error: 'start must be "YYYY-MM-DD HH:MM" (24h local time).' };
    const durationMin = Math.max(1, Number(a.duration_minutes) || 60);
    const alarmMin = Number(a.remind_minutes_before ?? 15);
    const title = String(a.title || 'Event').slice(0, 200);
    const res = await platform.addCalendarEvent({
      id: store.id(), title, start, durationMin, notes: String(a.notes || '').slice(0, 1000), alarmMin,
      calendarName: store.get('config').calendarName, dataDir: store.DIR, openPath: ctx.openPath,
    });
    let alert;
    if (alarmMin > 0 && start.getTime() - alarmMin * 60000 > Date.now()) {
      alert = impl.set_reminder({ text: `Upcoming: ${title} at ${fmt(start)}`, at: fmt(new Date(start.getTime() - alarmMin * 60000)) });
    }
    return { ok: true, title, start: fmt(start), duration_minutes: durationMin, ...res, alert_set: !!alert?.ok };
  },

  log_expense(a) {
    const amount = Number(String(a.amount).replace(/[^\d.]/g, ''));
    if (!(amount > 0)) return { error: 'amount must be a positive number.' };
    const kind = String(a.kind || 'debit').toLowerCase().startsWith('c') ? 'credit' : 'debit';
    const d = a.date ? parseLocal(a.date) : new Date();
    const e = {
      id: store.id(), amount, kind, category: String(a.category || 'other').toLowerCase().slice(0, 40),
      description: String(a.description || '').slice(0, 200), card: a.card ? String(a.card).slice(0, 40) : undefined,
      date: (d || new Date()).toISOString(), settled: false,
    };
    store.get('expenses').push(e);
    store.save('expenses');
    return { ok: true, id: e.id, amount, kind, category: e.category, card: e.card, currency: store.get('config').currency };
  },

  expense_summary(a) {
    const now = new Date();
    const starts = {
      today: startOfDay(now), week: new Date(now - 7 * 864e5), month: new Date(now.getFullYear(), now.getMonth(), 1),
      year: new Date(now.getFullYear(), 0, 1), all: new Date(0),
    };
    const period = starts[a.period] ? a.period : 'month';
    const rows = store.get('expenses').filter((e) => new Date(e.date) >= starts[period]);
    const sum = (f) => rows.filter(f).reduce((s, e) => s + e.amount, 0);
    const byCat = {};
    rows.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + e.amount));
    return {
      period, currency: store.get('config').currency, count: rows.length,
      total: sum(() => true), debit_total: sum((e) => e.kind === 'debit'), credit_total: sum((e) => e.kind === 'credit'),
      by_category: byCat,
      recent: rows.slice(-5).map((e) => `${dateKey(new Date(e.date))} ${e.kind} ${e.amount} ${e.category} ${e.description}`),
    };
  },

  add_card(a) {
    const due = Number(a.due_day);
    if (!(due >= 1 && due <= 31)) return { error: 'due_day must be 1-31.' };
    const cards = store.get('cards');
    let c = cards.find((x) => sameCard(x.name, a.name));
    if (!c) cards.push((c = { name: String(a.name || 'Card').slice(0, 40), paid_through: '' }));
    c.due_day = due;
    c.remind_days_before = Math.min(15, Math.max(0, Number(a.remind_days_before ?? 3)));
    store.save('cards');
    return { ok: true, card: c.name, due_day: c.due_day, remind_days_before: c.remind_days_before, next_due: dateKey(nextDue(c)) };
  },

  list_bills() {
    const cur = store.get('config').currency;
    const list = store.get('cards').map((c) => ({
      card: c.name, next_due: dateKey(nextDue(c)), days_left: Math.round((nextDue(c) - startOfDay(new Date())) / 864e5),
      outstanding_credit_spend: `${cur}${outstanding(c)}`,
    }));
    return list.length ? list : { cards: [], note: 'No cards registered yet.' };
  },

  mark_bill_paid(a) {
    const c = store.get('cards').find((x) => sameCard(x.name, a.card));
    if (!c) return { error: 'Unknown card. Use add_card first.' };
    const prev = prevDue(c);
    const overdue = (startOfDay(new Date()) - prev) / 864e5 <= 15 && dateKey(prev) > c.paid_through;
    c.paid_through = dateKey(overdue ? prev : nextDue(c));
    store.get('expenses').forEach((e) => { if (e.kind === 'credit' && sameCard(e.card, c.name)) e.settled = true; });
    store.save('cards');
    store.save('expenses');
    return { ok: true, card: c.name, paid_through: c.paid_through };
  },

  remember(a) {
    const fact = String(a.fact || '').trim().slice(0, 300);
    if (!fact) return { error: 'Nothing to remember.' };
    store.get('memories').push(fact);
    store.save('memories');
    return { ok: true };
  },

  forget(a) {
    const m = store.get('memories');
    const q = String(a.fact_or_number || '').toLowerCase();
    const i = /^\d+$/.test(q) ? Number(q) - 1 : m.findIndex((x) => x.toLowerCase().includes(q));
    if (!q || i < 0 || i >= m.length) return { error: 'No matching memory.' };
    const [gone] = m.splice(i, 1);
    store.save('memories');
    return { ok: true, forgot: gone };
  },

  scan_network: scanNetwork,

  async ha_list_entities(a) {
    const states = await haFetch('/api/states');
    return states
      .filter((s) => !a.domain || s.entity_id.startsWith(a.domain + '.'))
      .slice(0, 60)
      .map((s) => ({ entity_id: s.entity_id, state: s.state, name: s.attributes?.friendly_name }));
  },

  async ha_call_service(a, ctx) {
    const label = `${a.domain}.${a.service} on ${a.entity_id}`;
    if (!/^[a-z_]+$/.test(String(a.domain)) || !/^[a-z_]+$/.test(String(a.service))) return { error: 'Invalid domain or service.' };
    if (!(await ctx.confirm(`Allow Echo to run: ${label}?`))) return { error: 'User declined.' };
    await haFetch(`/api/services/${a.domain}/${a.service}`, { method: 'POST', body: JSON.stringify({ entity_id: a.entity_id }) });
    return { ok: true, ran: label };
  },

  api_search(a) {
    return integrations.count() ? integrations.search(a) : { error: 'No API integrations are set up. The user can add them in Settings (type /settings).' };
  },

  api_call: (a, ctx) => integrations.call(a, ctx),

  async make_call(a, ctx) {
    let number = String(a.number || '').trim();
    let label = String(a.name || '').trim();
    if (!/^\+?[\d\s\-()]{5,20}$/.test(number)) {
      const who = label || number;
      if (!who) return { error: 'Need a phone number or contact name.' };
      if (process.env.ECHO_DRY) number = '+10000000000';
      else {
        const found = await platform.lookupContact(who);
        if (found.error) return found;
        number = found.number;
      }
      label = label || who;
    }
    const clean = number.replace(/[^\d+]/g, '');
    if (!(await ctx.confirm(`Place a call to ${label || clean} (${clean})?`))) return { error: 'User declined.' };
    if (!process.env.ECHO_DRY && ctx.openExternal) await ctx.openExternal('tel:' + clean);
    return { ok: true, dialing: clean, note: platform.callNote };
  },

  bluetooth_devices: () => platform.bluetooth(),
};

const T = (name, description, properties = {}, required = []) => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required } },
});
const S = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'number', description });

const definitions = [
  T('set_reminder', 'Set a reminder (medicine, tasks, anything). Use in_minutes for relative times, or at for absolute times.', {
    text: S('What to remind about'), in_minutes: N('Minutes from now'), at: S('Local time "YYYY-MM-DD HH:MM" 24h'),
    repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'], description: 'REQUIRED for "every day/daily" (daily), "every week" (weekly), "every month" (monthly); otherwise none' },
  }, ['text']),
  T('list_reminders', 'List all pending reminders.'),
  T('cancel_reminder', 'Cancel a reminder by id or by words in its text.', { id_or_text: S('Reminder id or text') }, ['id_or_text']),
  T('add_calendar_event', 'Add an event/meeting to the user\'s calendar.', {
    title: S('Event title'), start: S('Local start "YYYY-MM-DD HH:MM" 24h'), duration_minutes: N('Length, default 60'),
    notes: S('Optional notes'), remind_minutes_before: N('Alert this many minutes before, default 15'),
  }, ['title', 'start']),
  T('log_expense', 'Log money spent. kind is "credit" (credit card) or "debit" (debit card/bank/cash).', {
    amount: N('Amount spent'), kind: { type: 'string', enum: ['credit', 'debit'] }, category: S('food, travel, bills, shopping...'),
    description: S('What it was for'), card: S('Card name, for credit spends'), date: S('Optional "YYYY-MM-DD"'),
  }, ['amount', 'kind']),
  T('expense_summary', 'Summarise spending for a period.', {
    period: { type: 'string', enum: ['today', 'week', 'month', 'year', 'all'] },
  }),
  T('add_card', 'Register a credit card and its bill due day of month, to get due-date alerts.', {
    name: S('Card name, e.g. HDFC'), due_day: N('Day of month bill is due (1-31)'), remind_days_before: N('Days of advance alerts, default 3'),
  }, ['name', 'due_day']),
  T('list_bills', 'Show cards, next due dates and outstanding credit spend.'),
  T('mark_bill_paid', 'Mark a credit card bill as paid (stops alerts, clears outstanding).', { card: S('Card name') }, ['card']),
  T('remember', 'Save a fact about the user to long-term memory.', { fact: S('The fact') }, ['fact']),
  T('forget', 'Delete a saved memory by number or words.', { fact_or_number: S('Memory number or text') }, ['fact_or_number']),
  T('scan_network', 'Discover devices and smart-home services (HomeKit, Chromecast, Hue, Matter, printers) on the local network. Takes ~10 seconds.'),
  T('ha_list_entities', 'List Home Assistant devices/entities and their state.', { domain: S('Optional: light, switch, climate...') }),
  T('ha_call_service', 'Control a home device via Home Assistant. User must approve.', {
    domain: S('e.g. light'), service: S('e.g. turn_on, turn_off'), entity_id: S('e.g. light.bedroom'),
  }, ['domain', 'service', 'entity_id']),
  T('make_call', 'Place a phone call through the user\'s phone (iPhone Continuity on Mac, Phone Link on Windows). Give a phone number or a contact name. User must approve.', {
    number: S('Phone number, e.g. +919876543210'), name: S('Contact name to look up'),
  }),
  T('bluetooth_devices', 'List Bluetooth devices currently connected to this computer.'),
];

const apiDefinitions = [
  T('api_search', 'Find operations in the user\'s connected API integrations. Only needed when the operation is not already listed in the system prompt.', {
    query: S('What you want to do, e.g. "get weather"'), integration: S('Optional integration name'),
  }, ['query']),
  T('api_call', 'Call an API operation from the user\'s connected integrations. Use the exact integration name and operation_id.', {
    integration: S('Integration name'), operation_id: S('operation_id'),
    params: { type: 'object', description: 'Path/query/header parameter values by name' },
    body: { type: 'object', description: 'JSON request body, if the operation takes one' },
  }, ['integration', 'operation_id']),
];

// Speed + accuracy: small local models do best with only the relevant tools.
// Pure chat gets NO tools, which keeps the prompt tiny and replies instant.
const GROUPS = [
  [/remind|alarm|alert|medicine|medication|pill|tablet|every (day|week|month|morning|night)|daily|weekly|monthly|cancel|wake me/i, ['set_reminder', 'list_reminders', 'cancel_reminder']],
  [/meeting|calendar|event|appointment|schedule|invite|tomorrow at|book a/i, ['add_calendar_event', 'set_reminder']],
  [/spen[dt]|expense|paid|pay\b|cost|bought|purchase|debit|credit|₹|\brs\b|rupee|\$|€|£|grocer|lunch|dinner|breakfast|budget|total|how much/i, ['log_expense', 'expense_summary']],
  [/card|bill|due|paid|statement/i, ['add_card', 'list_bills', 'mark_bill_paid']],
  [/remember|forget|memor|note that|\bmy \w+(?: \w+)? (?:is|are)\b|\bi (?:like|love|prefer|hate|live|work|am allergic)\b/i, ['remember', 'forget']],
  [/network|wi-?fi|devices|scan|discover/i, ['scan_network']],
  [/light|fan|lamp|switch|turn (?:on|off)|thermostat|\bac\b|home|bulb|plug|lock|entit/i, ['ha_list_entities', 'ha_call_service']],
  [/\bcall\b|phone|dial|\bring\b/i, ['make_call']],
  [/bluetooth/i, ['bluetooth_devices']],
];

function getDefinitions(text = '', previousTools = []) {
  const byName = Object.fromEntries(definitions.map((d) => [d.function.name, d]));
  const names = new Set();
  for (const [re, list] of GROUPS) if (re.test(text)) list.forEach((n) => names.add(n));
  const lower = String(text).toLowerCase();
  const hasApis = integrations.count() > 0;
  const apiMentioned = hasApis && integrations.list().some((i) => lower.includes(i.name.toLowerCase()));
  // Follow-ups ("make it 9pm instead") reuse the tool groups from the previous turn.
  const followUp = /\b(it|that|this|instead|change|make it|move|also|again|same|cancel|delete|undo|too|another|more)\b|^(and|also|actually|no|wait)\b/i.test(text);
  if (!names.size && previousTools.length && followUp) {
    for (const [, list] of GROUPS) if (list.some((n) => previousTools.includes(n))) list.forEach((n) => names.add(n));
  }
  const out = [...names].filter((n) => byName[n]).map((n) => byName[n]);
  if (apiMentioned || (hasApis && !names.size) || (hasApis && previousTools.some((n) => n.startsWith('api_')))) out.push(...apiDefinitions);
  return out;
}

const allToolNames = () => [...definitions, ...apiDefinitions].map((d) => d.function.name);

async function run(name, args, ctx) {
  const fn = impl[name];
  if (!fn) return { error: `Unknown tool ${name}` };
  try {
    return await fn(args && typeof args === 'object' ? args : {}, ctx || { confirm: async () => false });
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { definitions, getDefinitions, allToolNames, run, advance, dateKey, nextDue, prevDue, startOfDay, fmt, isLocalHost, parseLocal };
