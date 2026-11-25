// User-added API integrations: OpenAPI/Swagger import, encrypted tokens, guarded calls.
const store = require('./store');

let safeStorage = null;
try { const e = require('electron'); safeStorage = e && e.safeStorage ? e.safeStorage : null; } catch {}

function isLocalHost(urlStr) {
  try {
    const h = new URL(urlStr).hostname;
    return (
      h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local')
    );
  } catch {
    return false;
  }
}

// ---- secrets: Keychain-backed via Electron safeStorage (async API) ----
async function enc(token) {
  if (safeStorage && (await safeStorage.isAsyncEncryptionAvailable())) return 'e:' + (await safeStorage.encryptStringAsync(token)).toString('base64');
  if (process.env.ECHO_INSECURE_TEST) return 'p:' + Buffer.from(token).toString('base64'); // tests only
  throw new Error('Secure storage is unavailable, so the token was not saved.');
}
async function dec(s) {
  if (s.startsWith('e:')) return (await safeStorage.decryptStringAsync(Buffer.from(s.slice(2), 'base64'))).result;
  if (s.startsWith('p:') && process.env.ECHO_INSECURE_TEST) return Buffer.from(s.slice(2), 'base64').toString();
  throw new Error('Cannot decrypt stored token.');
}

// ---- OpenAPI / Swagger parsing ----
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const slug = (s) => String(s).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'op';

function deref(doc, node) {
  let n = 0;
  while (node && typeof node.$ref === 'string' && n++ < 5) {
    if (!node.$ref.startsWith('#/')) return {};
    node = node.$ref.slice(2).split('/').reduce((o, k) => o && o[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
  }
  return node || {};
}

function parseSpec(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 5e6) throw new Error('Schema is empty or too large.');
  let doc;
  try { doc = JSON.parse(text); } catch {
    try { doc = require('yaml').parse(text); } catch { throw new Error('Could not parse as JSON or YAML.'); }
  }
  if (!doc || typeof doc !== 'object' || !doc.paths || !(doc.openapi || doc.swagger)) throw new Error('Not an OpenAPI/Swagger document.');
  const baseUrl = doc.openapi
    ? doc.servers?.[0]?.url || ''
    : doc.host ? `${doc.schemes?.[0] || 'https'}://${doc.host}${doc.basePath || ''}` : '';
  const ops = [], seen = new Set();
  outer: for (const [p, item0] of Object.entries(doc.paths)) {
    const item = deref(doc, item0);
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const params = [...(item.parameters || []), ...(op.parameters || [])].map((x) => deref(doc, x))
        .filter((x) => x.name && ['path', 'query', 'header'].includes(x.in))
        .map((x) => ({ name: String(x.name), in: x.in, required: !!x.required }));
      const schema = deref(doc, deref(doc, op.requestBody).content?.['application/json']?.schema);
      const body = Object.keys(schema.properties || {}).length ? Object.keys(schema.properties).slice(0, 20)
        : op.requestBody || (op.parameters || []).some((x) => deref(doc, x).in === 'body') ? [] : null;
      let id = slug(op.operationId || `${m}_${p}`);
      for (let i = 2; seen.has(id); i++) id = slug(op.operationId || `${m}_${p}`) + '_' + i;
      seen.add(id);
      ops.push({ id, method: m.toUpperCase(), path: p, summary: String(op.summary || op.description || '').slice(0, 120), params, body });
      if (ops.length >= 300) break outer;
    }
  }
  return { title: String(doc.info?.title || 'API').slice(0, 60), description: String(doc.info?.description || '').slice(0, 160), baseUrl, ops };
}

// ---- management (used by the Settings window) ----
const all = () => store.get('integrations');
const find = (name) => {
  const q = String(name || '').toLowerCase().trim();
  const exact = all().find((i) => i.name.toLowerCase() === q || i.id === name);
  if (exact || !q) return exact || (all().length === 1 ? all()[0] : undefined);
  // forgiving match for small models: unique partial match either way, or the only integration
  const part = all().filter((i) => i.name.toLowerCase().includes(q) || q.includes(i.name.toLowerCase()) || (i.description || '').toLowerCase().includes(q));
  return part.length === 1 ? part[0] : all().length === 1 ? all()[0] : undefined;
};

function publicView(i) {
  return { id: i.id, name: i.name, baseUrl: i.baseUrl, authType: i.authType, authName: i.authName, hasToken: !!i.tokenEnc,
    opCount: i.ops.length, local: i.baseUrl ? isLocalHost(i.baseUrl) : null, description: i.description };
}
const list = () => all().map(publicView);

function create({ name, text }) {
  const spec = parseSpec(text);
  const nm = String(name || spec.title).trim().slice(0, 40) || 'API';
  if (all().some((i) => i.name.toLowerCase() === nm.toLowerCase())) throw new Error(`An integration named "${nm}" already exists.`);
  const it = { id: store.id(), name: nm, baseUrl: spec.baseUrl, authType: 'none', authName: '', tokenEnc: '', description: spec.description, ops: spec.ops };
  all().push(it);
  store.save('integrations');
  return publicView(it);
}

async function update(a) {
  const it = all().find((i) => i.id === a.id);
  if (!it) throw new Error('Integration not found.');
  if (typeof a.name === 'string' && a.name.trim()) it.name = a.name.trim().slice(0, 40);
  if (typeof a.baseUrl === 'string') {
    const u = a.baseUrl.trim();
    if (u) {
      const url = new URL(u); // throws if invalid
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(u))) throw new Error('Base URL must be https (http is only allowed for local-network hosts).');
    }
    it.baseUrl = u;
  }
  if (['none', 'bearer', 'header', 'query', 'basic'].includes(a.authType)) it.authType = a.authType;
  if (typeof a.authName === 'string') it.authName = a.authName.trim().slice(0, 60);
  if (a.clearToken) it.tokenEnc = '';
  if (typeof a.token === 'string' && a.token) it.tokenEnc = await enc(a.token);
  store.save('integrations');
  return publicView(it);
}

function remove(id) {
  const i = all().findIndex((x) => x.id === id);
  if (i >= 0) { all().splice(i, 1); store.save('integrations'); }
}

// ---- agent-facing ----
function promptSummary() {
  const total = all().reduce((n, i) => n + i.ops.length, 0);
  return all().map((i) => {
    let line = `- name "${i.name}"${i.description ? ' (' + i.description + ')' : ''}, ${i.ops.length} operations`;
    if (total <= 20) // small APIs: list operations inline so the model can call directly, no search step
      line += ':\n' + i.ops.map((o) => `    ${o.id}: ${o.method} ${o.path}${o.summary ? ' - ' + o.summary : ''}` +
        (o.params.length ? ` [params: ${o.params.map((p) => p.name + (p.required ? '*' : '')).join(', ')}]` : '') +
        (o.body?.length ? ` [body: ${o.body.join(', ')}]` : '')).join('\n');
    return line;
  }).join('\n');
}

const inlineOps = () => all().reduce((n, i) => n + i.ops.length, 0) <= 20;

function search({ query, integration }) {
  const words = String(query || '').toLowerCase().split(/\W+/).filter(Boolean);
  const hits = [];
  for (const it of all()) {
    if (integration && find(integration) && find(integration) !== it) continue;
    for (const o of it.ops) {
      const hay = `${it.name} ${o.id} ${o.method} ${o.path} ${o.summary}`.toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      if (score > 0 || !words.length) hits.push({ score, it, o });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8).map(({ it, o }) => ({
    integration: it.name, operation_id: o.id, method: o.method, path: o.path, summary: o.summary,
    params: o.params.map((p) => `${p.name} (${p.in}${p.required ? ', required' : ''})`), body_fields: o.body,
  }));
}

async function call(a, ctx) {
  const it = find(a.integration);
  if (!it) return { error: 'Unknown integration. Use api_search.' };
  const op = it.ops.find((o) => o.id === a.operation_id);
  if (!op) return { error: 'Unknown operation_id. Use api_search first.' };
  if (!it.baseUrl) return { error: `${it.name} has no base URL. Set it in Settings.` };
  const base = new URL(it.baseUrl);
  const external = !isLocalHost(it.baseUrl);
  if (external && store.get('config').localOnly)
    return { error: `Privacy mode is on (local only), so Echo won't contact ${base.host}. The user can allow internet APIs in Settings → Privacy.` };
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && isLocalHost(it.baseUrl)))
    return { error: 'Only https (or http on the local network) is allowed.' };

  const params = a.params && typeof a.params === 'object' ? a.params : {};
  let missing;
  const p = op.path.replace(/\{([^}]+)\}/g, (_, k) => {
    const v = params[k];
    if (v == null || String(v) === '' || String(v) === '.' || String(v) === '..') missing = k;
    return encodeURIComponent(String(v));
  });
  if (missing) return { error: `Missing or invalid path parameter "${missing}".` };
  const url = new URL(base.href.replace(/\/$/, '') + p);
  if (url.origin !== base.origin) return { error: 'Blocked: request would leave the integration host.' };

  const headers = { Accept: 'application/json' };
  for (const prm of op.params) {
    const v = params[prm.name];
    if (v == null) continue;
    if (prm.in === 'query') url.searchParams.set(prm.name, String(v));
    else if (prm.in === 'header' && prm.name.toLowerCase() !== 'authorization') headers[prm.name] = String(v);
  }
  const token = it.tokenEnc ? await dec(it.tokenEnc) : '';
  if (token) {
    if (it.authType === 'bearer') headers.Authorization = 'Bearer ' + token;
    else if (it.authType === 'header') headers[it.authName || 'X-API-Key'] = token;
    else if (it.authType === 'query') url.searchParams.set(it.authName || 'api_key', token);
    else if (it.authType === 'basic') headers.Authorization = 'Basic ' + Buffer.from(token).toString('base64');
  }

  let body;
  if (op.method !== 'GET' && a.body != null) {
    body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    headers['Content-Type'] = 'application/json';
  }
  if (op.method !== 'GET') {
    const preview = body ? '\n' + body.slice(0, 300) : '';
    if (!(await ctx.confirm(`${it.name}: ${op.method} ${url.origin}${url.pathname}${preview}`))) return { error: 'User declined.' };
  }

  try {
    const r = await fetch(url, { method: op.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (external) store.logNetwork({ purpose: `API: ${it.name}`, host: url.host, method: op.method, path: url.pathname, status: r.status });
    if (r.status >= 300 && r.status < 400) return { error: 'Redirect blocked for safety.', status: r.status };
    const text = await r.text();
    return { status: r.status, ok: r.ok, body: text.slice(0, 6000), truncated: text.length > 6000 };
  } catch (e) {
    if (external) store.logNetwork({ purpose: `API: ${it.name}`, host: url.host, method: op.method, path: url.pathname, status: 'failed' });
    let msg = e.message + (e.cause?.code ? ` (${e.cause.code})` : '');
    if (token) msg = msg.split(token).join('***');
    return { error: 'Request failed: ' + msg };
  }
}

module.exports = { isLocalHost, parseSpec, list, create, update, remove, find, promptSummary, inlineOps, search, call, count: () => all().length };
