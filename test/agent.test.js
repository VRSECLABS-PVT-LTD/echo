// Headless test: real local model, temp data dir, calendar in dry-run. No GUI needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.ECHO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-test-'));
process.env.ECHO_DRY = '1';

const store = require('../store');
if (process.env.ECHO_MODEL) store.get('config').model = process.env.ECHO_MODEL;
const agent = require('../agent');
const scheduler = require('../scheduler');
const tools = require('../tools');

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

async function ask(q) {
  const r = await agent.run(q, { confirm: async () => false });
  console.log(`\n> ${q}\n  tools: ${r.tools.join(', ') || '(none)'}\n  reply: ${r.reply}`);
  return r;
}

(async () => {
  // --- deterministic checks (no model) ---
  const fired = [];
  tools.run('set_reminder', { text: 'unit', in_minutes: 1 });
  scheduler.tick((t, b) => fired.push(b), new Date(Date.now() + 120000));
  check('scheduler fires due reminder', fired.includes('unit'));
  check('fired one-shot reminder removed', store.get('reminders').length === 0);

  await tools.run('add_card', { name: 'TestCard', due_day: new Date().getDate() + 2 > 28 ? 15 : new Date().getDate() + 2 });
  const f2 = [];
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  scheduler.tick((t, b) => f2.push(t), noon);
  check('bill advance alert fires', f2.some((t) => t.includes('coming up')) || new Date().getDate() + 2 > 28);
  const f3 = [];
  scheduler.tick((t) => f3.push(t), noon);
  check('bill alert not repeated same day', f3.length === 0);

  console.log('\nIsLocalHost:', ['http://192.168.1.5:8123', 'http://homeassistant.local', 'https://evil.com', 'http://10.0.0.2'].map((u) => tools.isLocalHost(u)));
  check('internet URLs rejected', !tools.isLocalHost('https://evil.com') && tools.isLocalHost('http://192.168.1.5:8123'));

  // --- model-driven checks ---
  const tomorrow = new Date(Date.now() + 864e5);
  let r = await ask('remind me to take my medicine in 10 minutes');
  check('reminder via model', r.tools.includes('set_reminder') && store.get('reminders').length === 1);

  r = await ask('remind me every day at 9am to take vitamin D');
  check('daily reminder via model', store.get('reminders').some((x) => x.repeat === 'daily'));

  r = await ask('I spent 450 on lunch with my credit card HDFC');
  check('credit expense via model', store.get('expenses').some((e) => e.amount === 450 && e.kind === 'credit'));

  r = await ask('log 1200 debit for groceries');
  check('debit expense via model', store.get('expenses').some((e) => e.amount === 1200 && e.kind === 'debit'));

  r = await ask('how much did I spend this month?');
  check('summary via model', r.tools.includes('expense_summary') && /1650|1,650/.test(r.reply), '(expects 1650)');

  r = await ask('my HDFC card bill is due on the 20th of every month');
  check('add card via model', store.get('cards').some((c) => /hdfc/i.test(c.name) && c.due_day === 20));

  r = await ask('set a meeting with Rahul tomorrow at 3pm for 30 minutes');
  check('calendar via model', r.tools.includes('add_calendar_event'));

  r = await ask('remember that my doctor is Dr. Mehta');
  check('memory via model', store.get('memories').some((m) => /mehta/i.test(m)));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  console.log('data dir:', process.env.ECHO_DATA);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
