// BIRGSOL AI Desktop — Electron shell שנותן ל-BIRGSOL כוח אמת: טרמינל, קבצים, ורשת בלי CORS.
// טוען את האפליקציה החיה (github.io) — כך שכל עדכון באתר מתעדכן גם באפליקציה, בלי לבנות מחדש.
// גשר native נחשף ל-window.BIRGSOL_NATIVE (ראה preload.js). מצב הקוד/הסוכן מזהים אותו ומדליקים יכולות-על.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs/promises');
const os = require('os');

const APP_URL = 'https://davidyosef2102014-netizen.github.io/watsapp/birgsolai.html';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860,
    title: 'BIRGSOL AI',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // אבטחה: הדף לא ניגש ל-Node ישירות, רק לגשר המבוקר
      nodeIntegration: false
    }
  });
  win.loadURL(APP_URL);
  // קישורים חיצוניים → נפתחים בדפדפן, לא בתוך האפליקציה
  win.webContents.setWindowOpenHandler(({ url }) => { require('electron').shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ══ גשר native — כלי-העל של הסוכן/מצב-קוד ══

// הרצת פקודת טרמינל — עם אישור מהמשתמש (בטיחות: LLM/סוכן לא מריץ בשקט)
ipcMain.handle('birgsol-run', async (e, cmd, cwd) => {
  cmd = String(cmd || '');
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['הרץ', 'ביטול'], defaultId: 1, cancelId: 1,
    title: 'BIRGSOL — הרצת פקודה', message: 'להריץ את הפקודה הבאה בטרמינל?', detail: cmd
  });
  if (response !== 0) return { ok: false, error: 'בוטל ע"י המשתמש' };
  return new Promise((resolve) => {
    exec(cmd, { cwd: cwd || os.homedir(), timeout: 180000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? err.message : null });
    });
  });
});

ipcMain.handle('birgsol-readfile', async (e, p) => {
  try { return { ok: true, content: await fs.readFile(String(p), 'utf8') }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-writefile', async (e, p, content) => {
  try { await fs.writeFile(String(p), String(content == null ? '' : content)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-listdir', async (e, p) => {
  try { const items = await fs.readdir(String(p || os.homedir()), { withFileTypes: true });
    return { ok: true, items: items.map(i => ({ name: i.name, dir: i.isDirectory() })) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
// רשת בלי CORS — בדיקת כל API, כמוני
ipcMain.handle('birgsol-fetch', async (e, url, options) => {
  try {
    const r = await fetch(String(url), options || {});
    const body = await r.text();
    return { ok: true, status: r.status, body: body.slice(0, 2000000) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-info', async () => ({ ok: true, platform: process.platform, home: os.homedir(), cwd: process.cwd() }));
