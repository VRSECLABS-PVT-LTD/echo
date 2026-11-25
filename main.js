// Echo by VRSecLabs: main process.
const { app, BrowserWindow, globalShortcut, ipcMain, Notification, Tray, Menu, screen, session, dialog, shell, nativeImage, safeStorage, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const MENU_NAME = 'VRSeclabs';
const SUPPORT_EMAIL = 'security@vrseclabs.in';
const REPORT_URL = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Echo: bug report / feedback')}`;
const PRODUCT = 'Echo by VRSecLabs';
const SITE = 'https://vrseclabs.in';
const OLLAMA_DOWNLOAD = 'https://ollama.com/download';

// ---- privacy hardening (before ready) ----
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('no-pings');
app.setName('Echo');
// Windows toasts only show for an AppUserModelID that has a Start-menu shortcut. The installer
// creates one for 'in.vrseclabs.echo'; in dev (`npm start`) Electron registers the exe path instead.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'in.vrseclabs.echo' : process.execPath);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  const store = require('./store');
  const agent = require('./agent');
  const scheduler = require('./scheduler');
  const integrations = require('./integrations');
  const platform = require('./platform');

  const W = 860;
  let win, tray, settingsWin, setupWin, dialogOpen = false, currentHotkey = null;

  const secureWeb = { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged };
  const lockDown = (w) => {
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
  };

  // Only fixed, known destinations may be opened outside the app.
  const EXTERNAL_OK = [SITE, OLLAMA_DOWNLOAD];
  async function openExternal(url) {
    const local = url.startsWith('tel:') || url === REPORT_URL; // handled by the phone / mail app, not by Echo
    const ok = local || EXTERNAL_OK.some((u) => url === u || url.startsWith(u + '/'));
    if (!ok) throw new Error('Blocked external URL');
    if (!local) store.logNetwork({ purpose: 'Opened in your browser', host: new URL(url).host, method: 'BROWSER' });
    await shell.openExternal(url);
  }
  const openPath = (p) => shell.openPath(p);

  // ---------- windows ----------
  function maxChatHeight() {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return Math.round(d.workArea.height * 0.72);
  }

  function createChatWindow() {
    win = new BrowserWindow({
      width: W, height: 140, show: false, frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, backgroundColor: '#00000000',
      // Sounds must play while the window is hidden and without a click (reminders fire in the background).
      webPreferences: { preload: path.join(__dirname, 'preload.js'), ...secureWeb, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('blur', () => { if (!dialogOpen && !process.env.ECHO_SHOW) win.hide(); });
    lockDown(win);
  }

  function toggle(forceShow) {
    if (!win) return;
    if (win.isVisible() && !forceShow) return win.hide();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = d.workArea;
    win.setPosition(Math.round(x + (width - W) / 2), Math.round(y + height * 0.12));
    win.show();
    win.focus();
    win.webContents.send('focus', { maxHeight: maxChatHeight(), status: chatStatus() });
  }

  function chatStatus() {
    const c = store.get('config');
    return { model: c.model, localOnly: c.localOnly, saveHistory: c.saveHistory, sounds: c.sounds !== false, hotkey: currentHotkey || c.hotkey, encrypted: store.encryptionStatus().enabled };
  }

  function openSettings(section) {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.show(); settingsWin.focus();
      if (section) settingsWin.webContents.send('goto', section);
      return;
    }
    settingsWin = new BrowserWindow({
      width: 900, height: 760, minWidth: 720, minHeight: 560, title: 'Echo Settings', backgroundColor: '#0b0f14',
      icon: path.join(__dirname, 'assets', 'icon.png'), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), ...secureWeb },
    });
    settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), section ? { hash: section } : undefined);
    lockDown(settingsWin);
    if (win) win.hide();
    app.focus({ steal: true });
  }

  function openSetup() {
    if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
    setupWin = new BrowserWindow({
      width: 980, height: 640, resizable: false, title: 'Welcome to Echo', backgroundColor: '#070a0e',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', autoHideMenuBar: true,
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload-setup.js'), ...secureWeb },
    });
    setupWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
    lockDown(setupWin);
    setupWin.on('closed', () => { setupWin = null; });
    app.focus({ steal: true });
  }

  // ---------- OS notifications ----------
  // Native Electron notifications first. If the OS rejects them we fall back to a per-OS
  // mechanism, so a reminder is never silently lost:
  //   macOS   – Electron uses UNUserNotificationCenter, which refuses apps that are not signed
  //             with a real Apple certificate (ad-hoc builds get "UNErrorDomain error 1").
  //             Fallback: osascript `display notification` (shows via Script Editor).
  //   Windows – toasts need a registered AppUserModelID (Start-menu shortcut). Fallback: tray balloon.
  //   Linux   – libnotify; fallback: notify-send.
  const ICON = path.join(__dirname, 'assets', 'icon.png');
  const liveNotes = new Set(); // keep references so click handlers survive garbage collection
  let nativeNotifyBroken = false;

  // Plays one of Echo's own sounds (renderer/sounds.js) from the chat window. Returns false if it can't,
  // so the caller can keep the system's default notification sound instead.
  function playSound(kind) {
    if (!kind || store.get('config').sounds === false) return false;
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return false;
    win.webContents.send('play-sound', kind);
    return true;
  }

  function fallbackNotify(title, body, silent) {
    const done = (e) => { if (e) console.warn('[notify] fallback failed:', e.message); };
    if (process.platform === 'darwin') {
      // Text is passed as argv, never interpolated into the script.
      const script = ['on run argv', `display notification (item 2 of argv) with title (item 1 of argv)${silent ? '' : ' sound name "Glass"'}`, 'end run'];
      execFile('/usr/bin/osascript', [...script.flatMap((l) => ['-e', l]), title, body], { timeout: 10000 }, done);
    } else if (process.platform === 'win32') {
      if (tray && !tray.isDestroyed()) tray.displayBalloon({ title, content: body, icon: nativeImage.createFromPath(ICON), respectQuietTime: false, noSound: silent });
    } else {
      const quiet = silent ? ['-h', 'boolean:suppress-sound:true'] : [];
      execFile('notify-send', ['-a', 'Echo', '-i', ICON, '-u', 'critical', ...quiet, title, body], { timeout: 10000 }, done);
    }
  }

  function notify(title, body, sound) {
    const full = `Echo · ${title}`;
    const silent = playSound(sound); // Echo's own sound replaces the OS one, so they never play on top of each other
    if (nativeNotifyBroken || !Notification.isSupported()) return fallbackNotify(full, body, silent);
    const n = new Notification({
      title: full, body, icon: ICON, silent,
      sound: process.platform === 'darwin' && !silent ? 'Glass' : undefined,
      timeoutType: 'never', // Windows/Linux: keep reminders on screen until dismissed
      urgency: 'critical', // Linux: stops daemons from hiding low-priority popups
    });
    const forget = () => liveNotes.delete(n);
    n.on('click', () => { forget(); toggle(true); });
    n.on('close', forget);
    n.on('failed', (_e, err) => {
      forget();
      console.warn('[notify] native notification failed, using fallback:', err);
      nativeNotifyBroken = true; // don't keep retrying a path the OS has refused
      fallbackNotify(full, body, silent);
    });
    liveNotes.add(n);
    if (liveNotes.size > 50) liveNotes.delete(liveNotes.values().next().value);
    n.show();
  }

  async function confirm(message) {
    dialogOpen = true;
    try {
      const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Deny'], defaultId: 1, cancelId: 1, title: PRODUCT, message });
      return response === 0;
    } finally {
      dialogOpen = false;
    }
  }

  function registerHotkey(accel) {
    if (currentHotkey) globalShortcut.unregister(currentHotkey);
    let ok = false;
    try { ok = globalShortcut.register(accel, () => toggle()); } catch {}
    if (ok) { currentHotkey = accel; return true; }
    if (currentHotkey && currentHotkey !== accel) globalShortcut.register(currentHotkey, () => toggle());
    return false;
  }

  function buildTray() {
    if (process.platform === 'darwin') {
      tray = new Tray(nativeImage.createEmpty()); // word mark only on macOS
      tray.setTitle(MENU_NAME);
    } else {
      tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
      tray.on('click', () => toggle());
    }
    tray.setToolTip(PRODUCT);
    refreshTrayMenu();
  }

  function refreshTrayMenu() {
    if (!tray) return;
    const c = store.get('config');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: PRODUCT, enabled: false },
      { label: c.localOnly ? 'Private: local-only mode' : 'Internet APIs allowed', enabled: false },
      { type: 'separator' },
      { label: `Open Echo (${currentHotkey || c.hotkey})`, click: () => toggle(true) },
      { label: 'Settings…', click: () => openSettings() },
      { label: 'Privacy & network log…', click: () => openSettings('privacy') },
      { type: 'separator' },
      { label: 'Report a problem…', click: () => openExternal(REPORT_URL).catch(() => {}) },
      { label: 'Visit vrseclabs.in', click: () => openExternal(SITE).catch(() => {}) },
      { label: 'Quit Echo', role: 'quit' },
    ]));
  }

  // ---------- Ollama ----------
  async function ensureOllamaRunning() {
    let s = await agent.ollamaStatus();
    if (s.running) return { ...s, installed: true };
    const bin = platform.findOllamaBinary();
    if (!bin) return { ...s, installed: false };
    if (process.platform === 'darwin' && fs.existsSync('/Applications/Ollama.app')) spawn('/usr/bin/open', ['-g', '-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
    else spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 20 && !s.running; i++) { await new Promise((r) => setTimeout(r, 500)); s = await agent.ollamaStatus(); }
    return { ...s, installed: true };
  }

  // ---------- IPC helpers ----------
  function handler(channel, getWin, fn) {
    ipcMain.handle(channel, async (e, arg) => {
      const w = getWin();
      if (!w || w.isDestroyed() || e.sender !== w.webContents) return { error: 'denied' };
      try { return { data: await fn(arg, e) }; } catch (err) { return { error: err.message }; }
    });
  }
  const S = () => settingsWin;
  const U = () => setupWin;

  function publicConfig() {
    const c = store.get('config');
    return {
      model: c.model, hotkey: currentHotkey || c.hotkey, currency: c.currency, localOnly: c.localOnly, saveHistory: c.saveHistory, sounds: c.sounds !== false,
      calendarName: c.calendarName, haUrl: c.homeAssistant.url, haHasToken: !!c.homeAssistant.token,
      platform: process.platform, supportEmail: SUPPORT_EMAIL, encryption: store.encryptionStatus(), dataDir: store.DIR, version: require('./package.json').version, site: SITE,
    };
  }

  function setConfig(a = {}) {
    const c = store.get('config');
    if (typeof a.model === 'string' && /^[\w.:\-/]{1,80}$/.test(a.model)) c.model = a.model;
    if (typeof a.hotkey === 'string' && a.hotkey && a.hotkey !== currentHotkey) {
      if (!registerHotkey(a.hotkey)) throw new Error(`Couldn't use ${a.hotkey}. It may be taken by another app.`);
      c.hotkey = a.hotkey;
    }
    if (typeof a.currency === 'string') c.currency = a.currency.slice(0, 5);
    if (typeof a.localOnly === 'boolean') c.localOnly = a.localOnly;
    if (typeof a.saveHistory === 'boolean') {
      c.saveHistory = a.saveHistory;
      if (!a.saveHistory) agent.clearHistory();
    }
    if (typeof a.sounds === 'boolean') c.sounds = a.sounds;
    if (typeof a.calendarName === 'string') c.calendarName = a.calendarName.slice(0, 80);
    if (typeof a.haUrl === 'string') {
      const u = a.haUrl.trim();
      if (u && !integrations.isLocalHost(u)) throw new Error('Home Assistant must be on your local network (e.g. http://homeassistant.local:8123).');
      c.homeAssistant.url = u;
    }
    if (typeof a.haToken === 'string' && a.haToken) c.homeAssistant.token = a.haToken;
    if (a.clearHaToken) c.homeAssistant.token = '';
    store.save('config');
    refreshTrayMenu();
    if (win) win.webContents.send('status', chatStatus());
    return publicConfig();
  }

  // ---------- startup ----------
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock.hide();

    // Privacy: app pages may never load anything off-machine; no permissions are ever granted.
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
      let ok = false;
      try { const u = new URL(d.url); ok = u.protocol === 'file:' || u.protocol === 'devtools:'; } catch {}
      cb({ cancel: !ok });
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    // Encrypt all local data with a key protected by the OS keychain.
    try {
      const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : process.platform === 'darwin' ? 'macOS Keychain' : 'Windows DPAPI';
      await store.initEncryption({
        available: () => safeStorage.isAsyncEncryptionAvailable(),
        wrap: async (buf) => (await safeStorage.encryptStringAsync(buf.toString('base64'))).toString('base64'),
        unwrap: async (s) => Buffer.from((await safeStorage.decryptStringAsync(Buffer.from(s, 'base64'))).result, 'base64'),
        weak: backend === 'basic_text',
        backend,
      });
    } catch (e) {
      const { response } = await dialog.showMessageBox({
        type: 'error', title: PRODUCT, buttons: ['Quit', 'Erase data and start fresh'], defaultId: 0, cancelId: 0,
        message: 'Echo could not unlock your encrypted data.',
        detail: `The key in your system keychain is missing or was changed (${e.message}). Your data stays encrypted and unreadable.`,
      });
      if (response === 1) { store.wipe(); app.relaunch(); }
      app.exit(0);
      return;
    }

    createChatWindow();
    const cfg = store.get('config');
    if (!registerHotkey(cfg.hotkey)) {
      const fallback = process.platform === 'darwin' ? 'Control+Alt+Space' : 'Control+Alt+E';
      if (registerHotkey(fallback)) { cfg.hotkey = fallback; store.save('config'); }
    }
    buildTray();

    // ---- chat IPC ----
    ipcMain.handle('ask', async (e, text) => {
      if (e.sender !== win.webContents) return { reply: 'denied', tools: [] };
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) return { reply: 'Invalid input.', tools: [] };
      return agent.run(text.trim(), {
        confirm, openExternal, openPath,
        onDelta: (t) => e.sender.send('delta', t),
        onReset: () => e.sender.send('reset'),
      });
    });
    ipcMain.handle('clear', (e) => { if (e.sender === win.webContents) agent.clearHistory(); });
    ipcMain.handle('status', () => chatStatus());
    ipcMain.on('hide', () => win.hide());
    ipcMain.on('resize', (e, h) => {
      if (e.sender === win.webContents && Number.isFinite(h)) win.setContentSize(W, Math.max(100, Math.min(maxChatHeight(), Math.ceil(h))));
    });
    ipcMain.on('open-settings', (e, section) => { if (e.sender === win.webContents) openSettings(typeof section === 'string' ? section : undefined); });

    // ---- settings IPC (only the Settings window may call these) ----
    handler('cfg:get', S, () => publicConfig());
    handler('cfg:set', S, (a) => setConfig(a));
    handler('models:list', S, async () => (await agent.ollamaStatus()).models);
    handler('netlog:get', S, () => [...store.get('netlog')].reverse());
    handler('netlog:clear', S, () => { store.get('netlog').length = 0; store.save('netlog'); });
    handler('data:open', S, () => shell.openPath(store.DIR));
    handler('data:wipe', S, async () => {
      const { response } = await dialog.showMessageBox(settingsWin, {
        type: 'warning', buttons: ['Cancel', 'Erase everything'], defaultId: 0, cancelId: 0, title: PRODUCT,
        message: 'Erase all Echo data?', detail: 'Reminders, expenses, cards, memories, chat history, integrations, tokens and the encryption key will be permanently deleted. This cannot be undone.',
      });
      if (response !== 1) return false;
      store.wipe();
      app.relaunch();
      app.exit(0);
      return true;
    });
    handler('open:site', S, () => openExternal(SITE));
    handler('open:report', S, () => openExternal(REPORT_URL));
    handler('setup:rerun', S, () => openSetup());
    handler('int:list', S, () => integrations.list());
    handler('int:importText', S, (a) => integrations.create({ name: String(a?.name || ''), text: String(a?.text || '') }));
    handler('int:importFile', S, async (a) => {
      const r = await dialog.showOpenDialog(settingsWin, { properties: ['openFile'], filters: [{ name: 'OpenAPI / Swagger', extensions: ['json', 'yaml', 'yml'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const f = r.filePaths[0];
      if (fs.statSync(f).size > 5e6) throw new Error('File is larger than 5 MB.');
      return integrations.create({ name: String(a?.name || ''), text: fs.readFileSync(f, 'utf8') });
    });
    handler('int:update', S, (a) => integrations.update(a || {}));
    handler('int:remove', S, (id) => integrations.remove(String(id)));

    // ---- setup IPC (only the setup window) ----
    const MODELS = [
      { id: 'llama3.2:3b', name: 'Echo Fast', base: 'Llama 3.2 · 3B', size: '2.0 GB', minRam: 8, blurb: 'Instant replies, great at reminders, expenses and everyday tasks.' },
      { id: 'llama3.2:1b', name: 'Echo Lite', base: 'Llama 3.2 · 1B', size: '1.3 GB', minRam: 4, blurb: 'For older or low-memory machines. Lightest and quickest.' },
      { id: 'qwen2.5:7b', name: 'Echo Pro', base: 'Qwen 2.5 · 7B', size: '4.7 GB', minRam: 16, blurb: 'Smarter answers and better reasoning. Needs 16 GB RAM.' },
    ];
    handler('setup:info', U, async () => {
      const ramGB = Math.round(os.totalmem() / 2 ** 30);
      const status = await ensureOllamaRunning();
      return {
        platform: process.platform, ramGB, cpu: os.cpus()[0]?.model || '', ollama: status,
        models: MODELS, recommended: ramGB < 8 ? 'llama3.2:1b' : 'llama3.2:3b', hotkey: currentHotkey || store.get('config').hotkey,
        site: SITE,
      };
    });
    handler('setup:check', U, () => ensureOllamaRunning());
    handler('setup:openDownload', U, () => openExternal(OLLAMA_DOWNLOAD));
    handler('setup:openSite', U, () => openExternal(SITE));
    handler('setup:copy', U, (text) => clipboard.writeText(String(text).slice(0, 500)));
    handler('setup:pull', U, async (model, e) => {
      if (!MODELS.some((m) => m.id === model)) throw new Error('Unknown model');
      store.logNetwork({ purpose: `Model download via Ollama (${model})`, host: 'registry.ollama.ai', method: 'GET' });
      await agent.pullModel(model, (p) => { if (!e.sender.isDestroyed()) e.sender.send('setup:progress', p); });
      return true;
    });
    handler('setup:finish', U, async (model) => {
      const c = store.get('config');
      if (typeof model === 'string' && /^[\w.:\-/]{1,80}$/.test(model)) c.model = model;
      c.setupDone = true;
      store.save('config');
      await agent.warmup();
      return true;
    });
    handler('setup:close', U, () => { setupWin.close(); setTimeout(() => toggle(true), 300); });

    scheduler.start(notify);

    const status = await ensureOllamaRunning();
    if (!store.get('config').setupDone || !status.running || !status.models.includes(store.get('config').model)) openSetup();
    else agent.warmup(); // keep the model hot for instant replies

    if (process.env.ECHO_SHOW) toggle(true);
  });

  app.on('second-instance', () => toggle(true));
  app.on('window-all-closed', () => {}); // stay alive in the tray
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
