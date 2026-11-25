// Cross-platform system helpers (macOS, Windows, Linux). Everything runs locally.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = process.platform;
const sh = (cmd, args, timeout = 10000) =>
  new Promise((res) => execFile(cmd, args, { timeout, windowsHide: true }, (e, out) => res(out || '')));

const pad = (n) => String(n).padStart(2, '0');

// ---------- network discovery ----------
const PING = P === 'darwin' ? '/sbin/ping' : 'ping';
const pingArgs = (ip) => (P === 'win32' ? ['-n', '1', '-w', '700', ip] : P === 'darwin' ? ['-c', '1', '-t', '1', ip] : ['-c', '1', '-W', '1', ip]);

async function pingSweep() {
  const iface = Object.values(os.networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal && i.netmask === '255.255.255.0');
  if (!iface) return;
  const base = iface.address.split('.').slice(0, 3).join('.');
  const queue = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  await Promise.all(Array.from({ length: 48 }, async () => {
    while (queue.length) await sh(PING, pingArgs(queue.pop()), 3000);
  }));
}

// Parses `arp -a` (macOS/Windows) and `ip neigh` (Linux) output.
function parseNeighbours(out) {
  const seen = new Map();
  for (const line of String(out).split(/\r?\n/)) {
    const ip = (line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/) || [])[1];
    const mac = (line.match(/\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i) || [])[1];
    if (!ip || !mac) continue;
    const m = mac.toLowerCase().replace(/-/g, ':');
    if (m === 'ff:ff:ff:ff:ff:ff' || /^(22[4-9]|23\d|255)\./.test(ip) || ip.endsWith('.255')) continue;
    const name = (line.match(/^(\S+) \(/) || [])[1];
    seen.set(ip, { ip, mac: m, name: name && name !== '?' ? name : undefined });
  }
  return [...seen.values()];
}

async function neighbours() {
  let out = '';
  if (P === 'linux') out = (await sh('ip', ['neigh'])) || (await sh('arp', ['-an']));
  else out = await sh(P === 'darwin' ? '/usr/sbin/arp' : 'arp', ['-a']);
  return parseNeighbours(out);
}

// ---------- bluetooth ----------
async function bluetooth() {
  if (P === 'darwin') {
    try {
      const root = JSON.parse(await sh('/usr/sbin/system_profiler', ['SPBluetoothDataType', '-json'], 20000)).SPBluetoothDataType?.[0] || {};
      return {
        power: root.controller_properties?.controller_state,
        connected: (root.device_connected || []).map((d) => {
          const [name, info] = Object.entries(d)[0];
          return { name, type: info.device_minorType || info.device_majorType };
        }),
      };
    } catch { return { error: 'Could not read Bluetooth state.' }; }
  }
  if (P === 'linux') {
    const out = await sh('bluetoothctl', ['devices', 'Connected']);
    if (!out) return { error: 'bluetoothctl not available or Bluetooth is off.' };
    return { connected: out.split('\n').map((l) => l.match(/^Device ([0-9A-F:]{17}) (.+)$/i)).filter(Boolean).map((m) => ({ name: m[2] })) };
  }
  if (P === 'win32') {
    const ps = "Get-PnpDevice -Class Bluetooth -Status OK | Where-Object { $_.FriendlyName -notmatch 'Enumerator|Adapter|Radio|Protocol|Service|Transport|Generic' } | Select-Object -ExpandProperty FriendlyName";
    const out = await sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 20000);
    return { connected: out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name })), note: 'Windows lists paired devices that are currently present.' };
  }
  return { error: 'Unsupported platform.' };
}

// ---------- calendar ----------
const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

function buildIcs({ uid, title, start, durationMin, notes, alarmMin }) {
  const end = new Date(start.getTime() + durationMin * 60000);
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VRSecLabs//Echo//EN', 'BEGIN:VEVENT',
    `UID:${uid}@echo.vrseclabs.in`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(title)}`, notes ? `DESCRIPTION:${icsEscape(notes)}` : null,
    alarmMin > 0 ? `BEGIN:VALARM\r\nTRIGGER:-PT${alarmMin}M\r\nACTION:DISPLAY\r\nDESCRIPTION:${icsEscape(title)}\r\nEND:VALARM` : null,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].filter((l) => l !== null).join('\r\n');
}

// macOS Calendar.app via AppleScript; arguments are passed as argv, never interpolated.
const CAL_SCRIPT = `
on run argv
  set t to item 1 of argv
  set s to current date
  set day of s to 1
  set year of s to (item 2 of argv) as integer
  set month of s to (item 3 of argv) as integer
  set day of s to (item 4 of argv) as integer
  set hours of s to (item 5 of argv) as integer
  set minutes of s to (item 6 of argv) as integer
  set seconds of s to 0
  set e to s + ((item 7 of argv) as integer) * minutes
  set calName to item 8 of argv
  tell application "Calendar"
    if calName is "" then
      set cal to first calendar whose writable is true
    else
      set cal to calendar calName
    end if
    tell cal to make new event with properties {summary:t, start date:s, end date:e, description:(item 9 of argv)}
    return name of cal
  end tell
end run`;

async function addCalendarEvent({ id, title, start, durationMin, notes, alarmMin, calendarName, dataDir, openPath }) {
  if (process.env.ECHO_DRY) return { calendar: 'dry-run' };
  if (P === 'darwin') {
    const args = [title, start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes(), durationMin, calendarName || '', notes || ''].map(String);
    const res = await new Promise((r) => execFile('/usr/bin/osascript', ['-e', CAL_SCRIPT, ...args], { timeout: 30000 }, (e, o) => r(e ? null : o.trim())));
    if (res) return { calendar: res };
    // fall through to .ics if Calendar access was denied
  }
  // Windows / Linux (and macOS fallback): write an .ics file and open it in the default calendar app.
  const dir = path.join(dataDir, 'calendar');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, `${id}.ics`);
  fs.writeFileSync(f, buildIcs({ uid: id, title, start, durationMin, notes, alarmMin }), { mode: 0o600 });
  if (openPath) await openPath(f);
  return { calendar: 'default calendar app', note: 'Opened the event in your calendar app. Confirm it there if asked.' };
}

// ---------- contacts (macOS only) ----------
const CONTACT_SCRIPT = `
on run argv
  tell application "Contacts"
    set ps to people whose name contains (item 1 of argv)
    if (count of ps) is 0 then return ""
    set p to item 1 of ps
    if (count of phones of p) is 0 then return ""
    return value of item 1 of phones of p
  end tell
end run`;

async function lookupContact(name) {
  if (P !== 'darwin') return { error: 'Contact lookup is only available on macOS. Please give the phone number.' };
  const out = await new Promise((r) => execFile('/usr/bin/osascript', ['-e', CONTACT_SCRIPT, name], { timeout: 20000 }, (e, o) => r(e ? '' : o.trim())));
  return out ? { number: out } : { error: `No phone number found in Contacts for "${name}".` };
}

// ---------- Ollama ----------
function findOllamaBinary() {
  const candidates = P === 'darwin'
    ? ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama']
    : P === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe')]
      : ['/usr/local/bin/ollama', '/usr/bin/ollama', '/snap/bin/ollama'];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

const callNote = P === 'darwin'
  ? 'Opened through iPhone Continuity / FaceTime. Confirm the Call button if shown.'
  : P === 'win32'
    ? 'Opened through Phone Link (or your default calling app). Confirm the call there.'
    : 'Opened with your default tel: handler (e.g. KDE Connect or GNOME Calls).';

module.exports = { platform: P, sh, pingSweep, neighbours, parseNeighbours, bluetooth, buildIcs, addCalendarEvent, lookupContact, findOllamaBinary, callNote };
