// Deterministic unit tests: no AI model, no Electron, no internet. Runs on macOS, Windows and Linux (CI).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

process.env.ECHO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-unit-'));
process.env.ECHO_DRY = '1';
process.env.ECHO_INSECURE_TEST = '1';

const store = require('../store');
const tools = require('../tools');
const scheduler = require('../scheduler');
const I = require('../integrations');
const platform = require('../platform');

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const yes = { confirm: async () => true }, no = { confirm: async () => false };
const D = process.env.ECHO_DATA;

(async () => {
  // ---------- encryption at rest ----------
  store.get('memories').push('plaintext before encryption');
  store.save('memories');
  check('plaintext written before encryption is enabled', fs.readFileSync(path.join(D, 'memories.json'), 'utf8').includes('plaintext'));
  const master = crypto.randomBytes(32); // stands in for the OS keychain
  const protector = {
    available: async () => true,
    wrap: async (buf) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', master, iv); const ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); },
    unwrap: async (s) => { const b = Buffer.from(s, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', master, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]); },
    backend: 'test-keychain',
  };
  const st = await store.initEncryption(protector);
  check('encryption enabled', st.enabled && st.backend === 'test-keychain');
  const raw = fs.readFileSync(path.join(D, 'memories.json'), 'utf8');
  check('existing plaintext migrated to ciphertext', raw.startsWith('ECHO1:') && !raw.includes('plaintext'));
  store.get('memories').push('secret: my bank is XYZ');
  store.save('memories');
  check('new data never hits disk in plaintext', !fs.readFileSync(path.join(D, 'memories.json'), 'utf8').includes('XYZ'));
  check('vault key file is not the raw key', fs.readFileSync(path.join(D, 'vault.key'), 'utf8').length > 60);
  if (process.platform !== 'win32') check('data files are owner-only (0600)', (fs.statSync(path.join(D, 'memories.json')).mode & 0o077) === 0);
  // tamper detection: flip a byte, reading must fail loudly (never silently reset)
  const tampered = raw.slice(0, 20) + (raw[20] === 'A' ? 'B' : 'A') + raw.slice(21);
  fs.writeFileSync(path.join(D, 'probe.json'), tampered);
  let threw = false;
  try { const b = Buffer.from(tampered.slice(6), 'base64'); const k = await protector.unwrap(fs.readFileSync(path.join(D, 'vault.key'), 'utf8')); const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); Buffer.concat([d.update(b.subarray(28)), d.final()]); } catch { threw = true; }
  fs.rmSync(path.join(D, 'probe.json'));
  check('tampered ciphertext is rejected (GCM auth)', threw);

  // ---------- reminders + scheduler ----------
  let r = await tools.run('set_reminder', { text: 'unit', in_minutes: 1 });
  check('set_reminder works', r.ok);
  const fired = [];
  scheduler.tick((t, b) => fired.push(b), new Date(Date.now() + 120000));
  check('scheduler fires due reminder', fired.includes('unit'));
  check('one-shot reminder removed after firing', store.get('reminders').length === 0);
  r = await tools.run('set_reminder', { text: 'vitamin', at: tools.fmt(new Date(Date.now() + 3600e3)), repeat: 'daily' });
  scheduler.tick(() => {}, new Date(Date.now() + 2 * 3600e3));
  check('daily reminder re-arms for tomorrow', store.get('reminders').length === 1 && new Date(store.get('reminders')[0].at) > new Date(Date.now() + 2 * 3600e3));
  r = await tools.run('set_reminder', { text: 'past', at: '2001-01-01 10:00' });
  check('past times rejected', !!r.error);
  r = await tools.run('cancel_reminder', { id_or_text: 'vitamin' });
  check('cancel_reminder by text', r.ok && store.get('reminders').length === 0);

  // ---------- expenses + bills ----------
  await tools.run('log_expense', { amount: 450, kind: 'credit', category: 'food', card: 'HDFC' });
  await tools.run('log_expense', { amount: '₹1,200', kind: 'debit', category: 'groceries' });
  r = await tools.run('expense_summary', { period: 'month' });
  check('expense summary totals', r.total === 1650 && r.credit_total === 450 && r.debit_total === 1200, JSON.stringify(r));
  const day = new Date().getDate();
  await tools.run('add_card', { name: 'TestCard', due_day: day + 2 > 28 ? 15 : day + 2 });
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const alerts = [];
  scheduler.tick((t) => alerts.push(t), noon);
  check('bill advance alert fires', alerts.some((t) => t.includes('coming up')) || day + 2 > 28);
  const again = [];
  scheduler.tick((t) => again.push(t), noon);
  check('bill alert not repeated the same day', again.length === 0);
  await tools.run('add_card', { name: 'HDFC', due_day: 20 });
  r = await tools.run('list_bills', {});
  check('outstanding credit spend per card', r.find((c) => c.card === 'HDFC')?.outstanding_credit_spend.endsWith('450'), JSON.stringify(r));
  r = await tools.run('mark_bill_paid', { card: 'hdfc' });
  check('mark_bill_paid settles credit spends', r.ok && (await tools.run('list_bills', {})).find((c) => c.card === 'HDFC').outstanding_credit_spend.endsWith('0'));

  // ---------- memory ----------
  r = await tools.run('remember', { fact: 'doctor is Dr. Mehta' });
  r = await tools.run('forget', { fact_or_number: 'mehta' });
  check('remember + forget', r.ok && !store.get('memories').some((m) => /mehta/i.test(m)));

  // ---------- calendar (.ics) ----------
  const ics = platform.buildIcs({ uid: 'u1', title: 'Sync, with; team', start: new Date(2030, 0, 2, 15, 0), durationMin: 30, notes: 'line1\nline2', alarmMin: 15 });
  check('ICS escapes text + has alarm', ics.includes('SUMMARY:Sync\\, with\\; team') && ics.includes('DTSTART:20300102T150000') && ics.includes('DTEND:20300102T153000') && ics.includes('TRIGGER:-PT15M') && ics.includes('line1\\nline2'));
  r = await tools.run('add_calendar_event', { title: 'Standup', start: tools.fmt(new Date(Date.now() + 864e5)) }, yes);
  check('calendar tool + auto alert reminder', r.ok && r.alert_set);

  // ---------- network neighbour parsing (all OS formats) ----------
  const mac = platform.parseNeighbours('? (192.168.1.1) at a4:2b:b0:1:2:3 on en0 ifscope [ethernet]\nrouter.lan (192.168.1.20) at 0:11:22:33:44:55 on en0\n? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0');
  check('parse macOS arp', mac.length === 2 && mac[1].name === 'router.lan');
  const lin = platform.parseNeighbours('192.168.0.7 dev wlan0 lladdr 3c:22:fb:aa:bb:cc REACHABLE\n192.168.0.9 dev wlan0  FAILED');
  check('parse Linux ip neigh', lin.length === 1 && lin[0].mac === '3c:22:fb:aa:bb:cc');
  const win = platform.parseNeighbours('Interface: 192.168.1.5 --- 0xb\n  Internet Address      Physical Address      Type\n  192.168.1.1           a4-2b-b0-01-02-03     dynamic\n  224.0.0.22            01-00-5e-00-00-16     static');
  check('parse Windows arp', win.length === 1 && win[0].mac === 'a4:2b:b0:01:02:03');

  // ---------- tool routing (speed + accuracy) ----------
  const names = (q, prev = []) => tools.getDefinitions(q, prev).map((d) => d.function.name);
  check('pure chat gets no tools', names('what is the capital of France?').length === 0 && names('hi', ['expense_summary']).length === 0);
  check('reminder routing', names('remind me to take my pill at 9pm').includes('set_reminder'));
  check('follow-up reuses previous tools', names('make it 9pm instead', ['set_reminder']).includes('set_reminder'));
  check('personal fact routes to memory', names('my favourite colour is teal').includes('remember'));

  // ---------- API integrations (local mock server) ----------
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b });
      if (req.url.startsWith('/v1/redir')) { res.writeHead(302, { Location: 'https://evil.example/' }); return res.end(); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise((r2) => server.listen(0, '127.0.0.1', r2));
  const port = server.address().port;
  const spec = `openapi: 3.0.0\ninfo: { title: Mock }\nservers: [{ url: "http://127.0.0.1:${port}/v1" }]\npaths:\n  /items/{id}: { get: { operationId: getItem, parameters: [{ name: id, in: path, required: true }] } }\n  /items: { post: { operationId: addItem, requestBody: { content: { application/json: { schema: { properties: { name: { type: string } } } } } } } }\n  /redir: { get: { operationId: redir } }\n`;
  const it = I.create({ name: 'Mock', text: spec });
  check('OpenAPI YAML import', it.opCount === 3 && it.local === true);
  await I.update({ id: it.id, authType: 'bearer', token: 'TOPSECRET' });
  check('API token not stored in plaintext', !fs.readFileSync(path.join(D, 'integrations.json'), 'utf8').includes('TOPSECRET'));
  r = await I.call({ integration: 'Mock', operation_id: 'getItem', params: { id: '42' } }, no);
  check('GET with bearer auth', r.status === 200 && seen.at(-1).auth === 'Bearer TOPSECRET' && seen.at(-1).url === '/v1/items/42');
  const n = seen.length;
  r = await I.call({ integration: 'Mock', operation_id: 'addItem', body: { name: 'x' } }, no);
  check('write blocked without approval', r.error === 'User declined.' && seen.length === n);
  r = await I.call({ integration: 'Mock', operation_id: 'getItem', params: { id: '..' } }, yes);
  check('path traversal rejected', !!r.error);
  r = await I.call({ integration: 'Mock', operation_id: 'redir' }, yes);
  check('redirects blocked', /redirect/i.test(r.error || ''));
  check('plain-http internet base URL rejected', await I.update({ id: it.id, baseUrl: 'http://example.com' }).then(() => false, () => true));

  // local-only privacy mode blocks internet hosts before any request is made
  const ext = I.create({ name: 'Ext', text: 'openapi: 3.0.0\ninfo: { title: E }\nservers: [{ url: "https://api.example.com" }]\npaths:\n  /a: { get: { operationId: a } }\n' });
  check('privacy mode defaults to local-only', store.get('config').localOnly === true);
  r = await I.call({ integration: 'Ext', operation_id: 'a' }, yes);
  check('local-only mode blocks internet APIs', /Privacy mode/.test(r.error || ''), JSON.stringify(r));
  check('blocked request was never logged as sent', store.get('netlog').length === 0);
  I.remove(ext.id);
  server.close();

  // ---------- phone ----------
  r = await tools.run('make_call', { number: '+91 98765-43210' }, yes);
  check('make_call normalises + needs approval', r.ok && r.dialing === '+919876543210' && (await tools.run('make_call', { number: '+911234567' }, no)).error === 'User declined.');

  // ---------- wipe ----------
  store.wipe();
  check('wipe removes all data + key', !fs.readdirSync(D).some((f) => f.endsWith('.json') || f === 'vault.key'));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
