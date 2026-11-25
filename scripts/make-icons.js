// Renders Echo's app + tray icons to PNG with Electron (no extra tools needed).
// Usage: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.join(__dirname, '..', 'assets');
const APP = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;display:grid;place-items:center">
 <div style="width:880px;height:880px;border-radius:200px;background:radial-gradient(120% 120% at 30% 20%,#11302a 0%,#0b1116 55%,#070a0e 100%);
   box-shadow:inset 0 0 0 6px rgba(0,229,160,.25);display:grid;place-items:center;position:relative;overflow:hidden">
  <div style="position:absolute;width:640px;height:640px;border-radius:50%;border:4px solid rgba(0,229,160,.18)"></div>
  <div style="position:absolute;width:480px;height:480px;border-radius:50%;border:4px solid rgba(0,229,160,.28)"></div>
  <div style="font:700 250px -apple-system,'Segoe UI',sans-serif;letter-spacing:-6px;color:#eafff7;text-shadow:0 0 60px rgba(0,229,160,.55)">Echo</div>
  <div style="position:absolute;bottom:120px;width:120px;height:14px;border-radius:7px;background:linear-gradient(90deg,#00e5a0,#22d3ee)"></div>
 </div></div></body></html>`;
const TRAY = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="zoom:4;width:64px;height:64px;display:grid;place-items:center">
 <div style="width:60px;height:60px;border-radius:14px;background:#111418;display:grid;place-items:center;
   font:700 28px -apple-system,'Segoe UI',Ubuntu,sans-serif;letter-spacing:-1px;color:#f2f4f6">VR</div></div></body></html>`;

async function render(html, size) {
  const w = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'echo-icon-')), 'i.html');
  fs.writeFileSync(tmp, html);
  await w.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage();
  w.destroy();
  return img;
}

app.on('window-all-closed', () => {}); // keep running between renders
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const icon = await render(APP, 1024);
  fs.writeFileSync(path.join(out, 'icon.png'), icon.resize({ width: 1024, height: 1024 }).toPNG());
  const tray = await render(TRAY, 256);
  fs.writeFileSync(path.join(out, 'tray@2x.png'), tray.resize({ width: 64, height: 64 }).toPNG());
  fs.writeFileSync(path.join(out, 'tray.png'), tray.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
  console.log('icons written to', out);
  app.exit(0);
});
