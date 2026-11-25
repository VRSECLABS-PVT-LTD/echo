// Local storage for Echo. Everything lives in ~/.echo-vrseclabs (owner-only permissions).
// When the app provides an OS-keychain-backed key wrapper, every file is encrypted at rest
// with AES-256-GCM. Nothing is ever sent anywhere.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LEGACY_DIR = path.join(os.homedir(), '.vrse-assistant');
const CUSTOM = process.env.ECHO_DATA;
const DIR = CUSTOM || path.join(os.homedir(), '.echo-vrseclabs');
if (!CUSTOM && !fs.existsSync(DIR) && fs.existsSync(LEGACY_DIR)) {
  try { fs.renameSync(LEGACY_DIR, DIR); } catch {}
}
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });

// Default currency from the system region, so the app feels local everywhere.
function defaultCurrency() {
  let region = '';
  try { region = (new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).maximize().region) || ''; } catch {}
  const map = { IN: '₹', US: '$', CA: '$', AU: '$', GB: '£', JP: '¥', CN: '¥', KR: '₩', BR: 'R$', AE: 'AED ', SG: 'S$' };
  const euro = ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR'];
  return map[region] || (euro.includes(region) ? '€' : '');
}

const DEFAULTS = {
  config: {
    model: 'llama3.2:3b',
    hotkey: process.platform === 'darwin' ? 'Alt+Space' : 'Control+Shift+Space',
    currency: defaultCurrency(),
    calendarName: '', // macOS: empty = first writable calendar
    homeAssistant: { url: '', token: '' },
    localOnly: true, // privacy mode: block every request that would leave the local network
    saveHistory: true,
    sounds: true, // Echo's own notification + reply sounds (off = system default notification sound)
    setupDone: false,
  },
  reminders: [],
  expenses: [],
  cards: [],
  memories: [],
  history: [],
  notified: {},
  integrations: [],
  netlog: [],
};

const MAGIC = 'ECHO1:';
const KEY_FILE = path.join(DIR, 'vault.key');
let KEY = null;
let encryption = { enabled: false, weak: false, backend: 'none' };

const cache = {};
const file = (k) => path.join(DIR, k + '.json');

function encryptText(s) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return MAGIC + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decryptText(s) {
  if (!KEY) throw new Error('Data is encrypted but the key is not available.');
  const b = Buffer.from(s.slice(MAGIC.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

function read(k) {
  const raw = fs.readFileSync(file(k), 'utf8');
  return JSON.parse(raw.startsWith(MAGIC) ? decryptText(raw) : raw);
}

function get(k) {
  if (cache[k]) return cache[k];
  let exists = true;
  try { cache[k] = read(k); } catch (e) {
    if (e.code !== 'ENOENT' && fs.existsSync(file(k))) throw e; // never silently overwrite unreadable data
    exists = false;
    cache[k] = structuredClone(DEFAULTS[k]);
  }
  if (k === 'config') cache[k] = { ...DEFAULTS.config, ...cache[k], homeAssistant: { ...DEFAULTS.config.homeAssistant, ...(cache[k].homeAssistant || {}) } };
  if (!exists && k === 'config') save(k);
  return cache[k];
}

function save(k) {
  const json = JSON.stringify(cache[k], null, KEY ? 0 : 2);
  const tmp = file(k) + '.tmp';
  fs.writeFileSync(tmp, KEY ? encryptText(json) : json, { mode: 0o600 });
  fs.renameSync(tmp, file(k));
}

// protector: { available(): Promise<bool>, wrap(Buffer): Promise<string>, unwrap(string): Promise<Buffer>, weak, backend }
async function initEncryption(protector) {
  if (!protector || !(await protector.available())) return encryption;
  if (fs.existsSync(KEY_FILE)) {
    KEY = await protector.unwrap(fs.readFileSync(KEY_FILE, 'utf8').trim()); // throws if the keychain entry is gone
    if (!KEY || KEY.length !== 32) throw new Error('Encryption key is invalid.');
  } else {
    KEY = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, await protector.wrap(KEY), { mode: 0o600 });
  }
  encryption = { enabled: true, weak: !!protector.weak, backend: protector.backend || 'os-keychain' };
  // Migrate any plaintext files (e.g. from older versions) to encrypted form.
  for (const k of Object.keys(DEFAULTS)) {
    if (!fs.existsSync(file(k))) continue;
    if (!fs.readFileSync(file(k), 'utf8').startsWith(MAGIC)) { get(k); save(k); }
  }
  return encryption;
}

function logNetwork(entry) {
  const log = get('netlog');
  log.push({ t: Date.now(), ...entry });
  if (log.length > 300) log.splice(0, log.length - 300);
  save('netlog');
}

// Erase everything Echo stored. Only removes files Echo created.
function wipe() {
  for (const k of Object.keys(DEFAULTS)) {
    for (const f of [file(k), file(k) + '.tmp']) if (fs.existsSync(f)) fs.rmSync(f);
    delete cache[k];
  }
  if (fs.existsSync(KEY_FILE)) fs.rmSync(KEY_FILE);
  const cal = path.join(DIR, 'calendar');
  if (fs.existsSync(cal)) fs.rmSync(cal, { recursive: true });
  KEY = null;
  encryption = { enabled: false, weak: false, backend: 'none' };
}

const id = () => crypto.randomBytes(4).toString('hex');

module.exports = { get, save, id, DIR, initEncryption, encryptionStatus: () => encryption, logNetwork, wipe };
