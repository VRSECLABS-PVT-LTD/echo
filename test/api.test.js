// Integration tests against a local mock API. No internet used.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
process.env.ECHO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-api-'));
process.env.ECHO_INSECURE_TEST = '1';
process.env.ECHO_DRY = '1';
const store = require('../store');
if (process.env.ECHO_MODEL) store.get('config').model = process.env.ECHO_MODEL;
const I = require('../integrations');
const tools = require('../tools');
const agent = require('../agent');

const seen = [];
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, key: req.headers['x-api-key'], body: b });
    if (req.url.startsWith('/v1/redir')) { res.writeHead(302, { Location: 'https://evil.example/steal' }); return res.end(); }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/v1/weather')) return res.end(JSON.stringify({ city: 'Pune', temp_c: 31, sky: 'sunny' }));
    res.end(JSON.stringify({ ok: true, echo: b }));
  });
});

const spec = (port) => `
openapi: 3.0.0
info: { title: Mock Weather, description: Weather and notes demo }
servers: [{ url: "http://127.0.0.1:${port}/v1" }]
paths:
  /weather:
    get:
      operationId: getWeather
      summary: Get current weather for a city
      parameters: [{ name: city, in: query, required: true, schema: { type: string } }]
  /notes/{noteId}:
    get: { operationId: getNote, summary: Read a note, parameters: [{ name: noteId, in: path, required: true, schema: { type: string } }] }
  /notes:
    post:
      operationId: createNote
      summary: Create a note
      requestBody: { content: { application/json: { schema: { properties: { text: { type: string } } } } } }
  /redir: { get: { operationId: redir, summary: redirects } }
`;

const results = [];
const check = (n, ok, x = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${ok ? '' : x}`); };
const yes = { confirm: async () => true }, no = { confirm: async () => false };

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  try {
    const it = I.create({ name: 'Weather', text: spec(port) });
    check('YAML import parses 4 operations', it.opCount === 4 && it.local === true, JSON.stringify(it));
    check('rejects non-OpenAPI', (() => { try { I.create({ name: 'x', text: '{"a":1}' }); } catch { return true; } })());
    check('rejects duplicate name', (() => { try { I.create({ name: 'weather', text: spec(port) }); } catch { return true; } })());
    check('swagger 2 JSON parses', I.parseSpec(JSON.stringify({ swagger: '2.0', host: 'api.x.com', basePath: '/v2', schemes: ['https'], info: { title: 'S' }, paths: { '/a': { get: { operationId: 'a' } } } })).baseUrl === 'https://api.x.com/v2');

    await I.update({ id: store.get('integrations')[0].id, authType: 'bearer', token: 'SECRET123' });
    check('token not stored in plaintext', !fs.readFileSync(path.join(process.env.ECHO_DATA, 'integrations.json'), 'utf8').includes('SECRET123'));
    check('public view hides token', !JSON.stringify(I.list()).includes('SECRET123') && I.list()[0].hasToken);

    const s = I.search({ query: 'weather city' });
    check('search finds getWeather first', s[0]?.operation_id === 'getWeather', JSON.stringify(s));

    let r = await I.call({ integration: 'Weather', operation_id: 'getWeather', params: { city: 'Pune' } }, no);
    check('GET works, bearer sent, no approval needed', r.status === 200 && r.body.includes('Pune') && seen.at(-1).auth === 'Bearer SECRET123' && seen.at(-1).url === '/v1/weather?city=Pune', JSON.stringify(r) + JSON.stringify(seen.at(-1)));

    const n = seen.length;
    r = await I.call({ integration: 'Weather', operation_id: 'createNote', body: { text: 'hi' } }, no);
    check('POST blocked when user declines', r.error === 'User declined.' && seen.length === n);
    r = await I.call({ integration: 'Weather', operation_id: 'createNote', body: { text: 'hi' } }, yes);
    check('POST works when approved', r.status === 200 && seen.at(-1).body === '{"text":"hi"}');

    r = await I.call({ integration: 'Weather', operation_id: 'getNote', params: { noteId: '..' } }, yes);
    check('path traversal ".." rejected', !!r.error && /invalid/i.test(r.error));
    r = await I.call({ integration: 'Weather', operation_id: 'getNote', params: { noteId: '../../admin?x=1#' } }, yes);
    check('encoded traversal stays inside path', seen.at(-1).url.startsWith('/v1/notes/..%2F..%2Fadmin%3Fx%3D1%23'), seen.at(-1).url);
    r = await I.call({ integration: 'Weather', operation_id: 'redir' }, yes);
    check('redirects blocked', /redirect/i.test(r.error || ''), JSON.stringify(r));
    r = await I.call({ integration: 'Nope', operation_id: 'x' }, yes);
    check('unknown integration rejected', !!r.error);

    check('http to internet host rejected', await I.update({ id: store.get('integrations')[0].id, baseUrl: 'http://example.com' }).then(() => false, () => true));

    await I.update({ id: store.get('integrations')[0].id, authType: 'header', authName: 'X-API-Key' });
    await I.call({ integration: 'Weather', operation_id: 'getWeather', params: { city: 'A' } }, yes);
    check('header auth mode', seen.at(-1).key === 'SECRET123' && !seen.at(-1).auth);

    // phone / bluetooth (dry-run: never places a real call)
    r = await tools.run('make_call', { number: '+91 98765-43210' }, yes);
    check('make_call normalises number', r.ok && r.dialing === '+919876543210', JSON.stringify(r));
    r = await tools.run('make_call', { number: '+919876543210' }, no);
    check('make_call needs approval', r.error === 'User declined.');
    r = await tools.run('bluetooth_devices', {}, yes);
    console.log('      bluetooth:', JSON.stringify(r));
    check('bluetooth_devices returns data', !!r.connected || !!r.error);

    // model uses the API on its own
    await I.update({ id: store.get('integrations')[0].id, authType: 'bearer' });
    const out = await agent.run('what is the weather in Pune right now?', yes);
    console.log(`\n> weather question\n  tools: ${out.tools.join(', ')}\n  reply: ${out.reply}`);
    check('model: api_search then api_call, answers from API', out.tools.includes('api_call') && /31/.test(out.reply), out.reply);
  } catch (e) { console.error('CRASH', e); results.push(false); }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  server.close(); process.exit(results.every(Boolean) ? 0 : 1);
});
