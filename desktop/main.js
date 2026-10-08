// BIRGSOL AI Desktop — Electron shell שנותן ל-BIRGSOL כוח אמת: טרמינל, קבצים, רשת בלי CORS, ושליטה בדפדפן.
// טוען את האפליקציה החיה (github.io) — כך שכל עדכון באתר מתעדכן גם באפליקציה, בלי לבנות מחדש.
// גשר native נחשף ל-window.BIRGSOL_NATIVE (ראה preload.js).

const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const http = require('http');

const APP_URL = 'https://davidyosef2102014-netizen.github.io/watsapp/birgsolai.html';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860,
    title: 'BIRGSOL AI',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadURL(APP_URL + '?t=' + Date.now()); // cache-bust — תמיד טוען גרסה טרייה, בלי מטמון ישן
  try { win.webContents.session.clearCache(); } catch (e) {}
  win.webContents.setWindowOpenHandler(({ url }) => { require('electron').shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  createWindow();
  _bridgeStart();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// #2: לנקות תהליכי-רקע (שרתים) בסגירה — כדי שלא יישארו Orphan תופסי-פורט
app.on('before-quit', () => {
  _bgProcs.forEach(p => { try { process.kill(p.pid); } catch (e) {} });
  try { session.defaultSession.flushStorageData(); } catch (e) {} // שמור התחברות/נתונים לדיסק לפני סגירה
});
// שמירה תקופתית של הנתונים לדיסק — כדי שההתחברות תשרוד גם סגירה פתאומית
setInterval(() => { try { session.defaultSession.flushStorageData(); } catch (e) {} }, 20000);

// ══════════════ תשתית טרמינל: הרצה חכמה (לא-חוסמת) + שחרור פורטים ══════════════
let _bgProcs = []; // תהליכי-רקע שהופעלו (שרתים)

// זיהוי פקודת-שרת שחוסמת את הטרמינל (לא חוזרת ל-prompt)
const _isServerCmd = (c) => /(\bnode\b[^\n]*server)|npm\s+(run\s+)?(start|dev|serve)|yarn\s+(start|dev|serve)|pnpm\s+(start|dev)|http-server|python3?\s+-m\s+http\.server|flask\s+run|uvicorn|gunicorn|\bvite\b|next\s+(dev|start)|nodemon|\bserve\b|php\s+-S|rails\s+s|manage\.py\s+runserver/i.test(c);
const _parsePort = (c) => {
  let m = c.match(/--port[=\s]+(\d{2,5})/i) || c.match(/-p[=\s]+(\d{2,5})/i) || c.match(/PORT[=:]\s*(\d{2,5})/i) || c.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:(\d{4,5})\b/) || c.match(/-S\s+\S+:(\d{2,5})/);
  return m ? parseInt(m[1], 10) : null;
};
// #2: לשחרר פורט תפוס (הורג את התהליך שמאזין עליו) — מונע EADDRINUSE
function _freePort(port) {
  return new Promise((res) => {
    exec(`netstat -ano | findstr :${port}`, { windowsHide: true }, (e, out) => {
      if (!out) return res(0);
      const pids = new Set();
      out.split(/\r?\n/).forEach(l => { const m = l.trim().match(/LISTENING\s+(\d+)/i); if (m) pids.add(m[1]); });
      if (!pids.size) return res(0);
      let n = pids.size; const total = n;
      pids.forEach(pid => exec(`taskkill /F /PID ${pid}`, { windowsHide: true }, () => { if (--n <= 0) res(total); }));
    });
  });
}

// הרצת פקודה — עם אישור נייטיב רק על פקודות הרסניות (הסוכן כבר מאשר בעצמו לפי הצורך).
ipcMain.handle('birgsol-run', async (e, cmd, cwd) => {
  cmd = String(cmd || '');
  const workdir = cwd || os.homedir();
  const _destr = /rm\s+-rf|rmdir\s+\/s|\bdel\s+\/[a-z]|\bformat\b|mkfs|drop\s+table|shutdown|reboot|diskpart|>\s*\/dev\/|:\(\)\s*\{|git\s+push[^\n]*--force/i;
  if (_destr.test(cmd)) {
    const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['הרץ בכל זאת', 'ביטול'], defaultId: 1, cancelId: 1, title: 'BIRGSOL — פקודה מסוכנת', message: 'הפקודה הזו עלולה למחוק/לשנות דברים. להריץ?', detail: cmd });
    if (response !== 0) return { ok: false, error: 'בוטל ע"י המשתמש' };
  }
  // #1: פקודת-שרת (או פקודה שמסתיימת ב-&) → מריצים ברקע ומחזירים מיד, כדי שהטרמינל לא ייתקע
  const wantsBg = /&\s*$/.test(cmd) || _isServerCmd(cmd);
  if (wantsBg) {
    const clean = cmd.replace(/&\s*$/, '').trim();
    const port = _parsePort(clean) || (_isServerCmd(clean) ? 3000 : null);
    let freed = 0;
    if (port) freed = await _freePort(port); // #2: לפנות את הפורט לפני העלאה
    try {
      const child = spawn(clean, { cwd: workdir, shell: true, windowsHide: true });
      let out = ''; const grab = d => { out += String(d); if (out.length > 4000) out = out.slice(-4000); };
      child.stdout && child.stdout.on('data', grab); child.stderr && child.stderr.on('data', grab);
      let earlyExit = null; child.on('exit', code => { earlyExit = code; _bgProcs = _bgProcs.filter(p => p.pid !== child.pid); });
      _bgProcs.push({ pid: child.pid, cmd: clean, port });
      await new Promise(r => setTimeout(r, 2600)); // רגע — לתפוס שגיאות מיידיות / לוודא שמאזין
      if (earlyExit !== null && earlyExit !== 0) return { ok: false, code: earlyExit, stdout: out, stderr: out, error: 'השרת נפל מיד (קוד ' + earlyExit + '). בדוק את הפלט.' };
      const note = '🟢 הופעל ברקע (pid ' + child.pid + (port ? ', פורט ' + port : '') + ')' + (freed ? ' [שוחרר פורט תפוס]' : '') + '. הטרמינל פנוי — אפשר להמשיך (למשל לפתוח דפדפן על הכתובת). פלט ראשוני:\n' + (out.slice(0, 1500) || '(אין פלט עדיין)');
      return { ok: true, background: true, pid: child.pid, port, stdout: note, stderr: '' };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  // פקודה רגילה — עם timeout שמחזיר במקום להיתקע לנצח
  return new Promise((resolve) => {
    exec(cmd, { cwd: workdir, timeout: 120000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const timedOut = err && err.killed;
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') + (timedOut ? '\n[⏱️ הפקודה חצתה 120 שניות ונעצרה. אם זו פקודת-שרת — הרץ אותה עם & בסוף כדי שתרוץ ברקע]' : ''), error: err ? err.message : null });
    });
  });
});
// #2: כלים לשחרור פורטים/תהליכי-רקע — הסוכן יכול לקרוא להם כדי לנקות לפני/אחרי
ipcMain.handle('birgsol-killport', async (e, port) => { const n = await _freePort(Number(port)); return { ok: true, killed: n }; });
ipcMain.handle('birgsol-killbg', async () => { let k = 0; _bgProcs.forEach(p => { try { process.kill(p.pid); k++; } catch (e) {} }); _bgProcs = []; return { ok: true, killed: k }; });

// ══════════════ קבצים + רשת ══════════════
ipcMain.handle('birgsol-readfile', async (e, p) => {
  try { return { ok: true, content: await fs.readFile(String(p), 'utf8') }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-writefile', async (e, p, content) => {
  try { await fs.writeFile(String(p), String(content == null ? '' : content)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
// #4: מחיקה בטוחה — fs.unlink סוגר כראוי (בניגוד למחיקה בזמן stream פתוח). retry קצר על נעילת-קובץ.
ipcMain.handle('birgsol-deletefile', async (e, p) => {
  for (let i = 0; i < 3; i++) {
    try { await fs.unlink(String(p)); return { ok: true }; }
    catch (err) { if ((err.code === 'EBUSY' || err.code === 'EPERM') && i < 2) { await new Promise(r => setTimeout(r, 400)); continue; } return { ok: false, error: err.message + ' (הקובץ אולי נעול/פתוח — ודא שסגרת כל stream לפני מחיקה)' }; }
  }
});
ipcMain.handle('birgsol-listdir', async (e, p) => {
  try { const items = await fs.readdir(String(p || os.homedir()), { withFileTypes: true });
    return { ok: true, items: items.map(i => ({ name: i.name, dir: i.isDirectory() })) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-fetch', async (e, url, options) => {
  try { const r = await fetch(String(url), options || {}); const body = await r.text(); return { ok: true, status: r.status, body: body.slice(0, 2000000) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

// 🔑 מפתח NVIDIA נשמר מקומית בלבד (קובץ nvidia.key על המחשב) — לעולם לא בקוד הציבורי ולא ב-localStorage.
// הסוכן קורא ל-GLM-5.3 המלא דרך ההנדלר הזה; המפתח מוזרק כאן בתהליך הראשי ולא נחשף לדף.
let _nvKeyCache = null;
async function _readNvidiaKey() {
  if (_nvKeyCache !== null) return _nvKeyCache;
  const candidates = [path.join(app.getPath('userData'), 'nvidia.key'), path.join(__dirname, 'nvidia.key')];
  for (const f of candidates) {
    try { const k = (await fs.readFile(f, 'utf8')).trim(); if (k && k.startsWith('nvapi-')) { _nvKeyCache = k; return k; } } catch (_) {}
  }
  _nvKeyCache = '';
  return '';
}
ipcMain.handle('birgsol-nvidia-chat', async (e, payload) => {
  try {
    const key = await _readNvidiaKey();
    if (!key) return { ok: false, error: 'no-key' };
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(payload || {})
    });
    const body = await r.text();
    return { ok: true, status: r.status, body: body.slice(0, 2000000) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-info', async () => ({ ok: true, platform: process.platform, home: os.homedir(), cwd: process.cwd() }));

// ══════════════ Native approval window (English) — shown on the computer when the agent wants to change something ══════════════
// Returns { ok:boolean, note:string }. A native OS toast fires too, and the window has a text field to send the agent a note.
ipcMain.handle('birgsol-confirm', async (e, message, opts) => {
  opts = opts || {};
  return await new Promise((resolve) => {
    let settled = false, cw = null;
    const onResult = (ev, payload) => finish(payload || { ok: false, note: '' });
    function finish(r) {
      if (settled) return; settled = true;
      try { ipcMain.removeListener('birgsol-confirm-result', onResult); } catch (_) {}
      try { if (cw && !cw.isDestroyed()) cw.close(); } catch (_) {}
      resolve({ ok: !!(r && r.ok), note: String((r && r.note) || '') });
    }
    ipcMain.on('birgsol-confirm-result', onResult);
    try { const { Notification } = require('electron'); if (Notification.isSupported()) new Notification({ title: 'BIRGSOL Agent', body: String(opts.title || 'Approval needed') }).show(); } catch (_) {}
    const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const title = opts.title || 'Agent approval';
    const allowNote = opts.note !== false;
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
      + 'body{font-family:Segoe UI,system-ui,sans-serif;margin:0;background:#0f172a;color:#e2e8f0;padding:18px}'
      + 'h2{font-size:16px;margin:0 0 8px}.act{font:13px/1.5 Consolas,monospace;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:170px;overflow:auto;margin:8px 0;direction:ltr}'
      + 'textarea{width:100%;box-sizing:border-box;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px;font:13px system-ui;min-height:50px;resize:vertical}'
      + '.row{display:flex;gap:8px;margin-top:12px}button{flex:1;padding:11px;border:none;border-radius:10px;font:600 14px system-ui;cursor:pointer}'
      + '.ok{background:#16a34a;color:#fff}.no{background:#334155;color:#e2e8f0}.lbl{font-size:12px;color:#94a3b8;margin:10px 0 4px}</style></head><body>'
      + '<h2>' + esc(title) + '</h2><div class="act">' + esc(message) + '</div>'
      + (allowNote ? '<div class="lbl">Note to the agent (optional):</div><textarea id="note" placeholder="e.g. use a different folder, skip this step..."></textarea>' : '')
      + '<div class="row"><button class="no" onclick="send(false)">Reject</button><button class="ok" onclick="send(true)">Approve</button></div>'
      + '<script>const {ipcRenderer}=require("electron");function send(ok){var n=document.getElementById("note");ipcRenderer.send("birgsol-confirm-result",{ok:ok,note:n?n.value:""});}'
      + 'window.addEventListener("keydown",function(e){if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))send(true);if(e.key==="Escape")send(false);});</script></body></html>';
    try {
      cw = new BrowserWindow({ width: 470, height: allowNote ? 370 : 230, title: 'BIRGSOL — ' + title, alwaysOnTop: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
      cw.setMenuBarVisibility(false);
      cw.on('closed', () => finish({ ok: false, note: '' }));
      cw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      cw.once('ready-to-show', () => { try { cw.show(); cw.focus(); } catch (_) {} });
    } catch (err) { finish({ ok: false, note: '' }); }
  });
});

// ══════════════ שליטת-דפדפן נייטיבית (חלון-עבודה) ══════════════
let workWin = null;
let _workConsole = [];   // שגיאות/לוגים מהדף (לבדיקת "אין שגיאות אדומות")
let _workCrashed = false;
function _ensureWorkWin() {
  if (workWin && !workWin.isDestroyed()) return workWin;
  // partition קבוע — חלון-העבודה זוכר התחברויות/עוגיות בין הרצות (לא "דפדפן ריק" בכל פעם)
  workWin = new BrowserWindow({ width: 1200, height: 850, title: 'BIRGSOL — חלון עבודה', webPreferences: { contextIsolation: true, nodeIntegration: false, partition: 'persist:birgsol-work' } });
  workWin.on('closed', () => { workWin = null; });
  // קליטת קונסול הדף (כולל שגיאות תחביר/ריצה שכרום מדפיס כ-error) — כדי שהסוכן יראה "שגיאות אדומות"
  try {
    workWin.webContents.on('did-start-loading', () => { _workConsole = []; _workCrashed = false; });
    workWin.webContents.on('console-message', (e, level, message, line, source) => {
      _workConsole.push({ level: level === 3 ? 'error' : level === 2 ? 'warn' : 'log', message: String(message || '').slice(0, 300), line, source: String(source || '').split(/[\\/]/).pop() });
      if (_workConsole.length > 60) _workConsole.shift();
    });
    workWin.webContents.on('render-process-gone', () => { _workCrashed = true; });
  } catch (e) {}
  return workWin;
}
// קורא את הדף: מתייג אלמנטים אינטראקטיביים ב-data-bref ומחזיר title/url/text/fields
function _pageReader() {
  var clip = function (s) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, 90); };
  var fields = [];
  try {
    var els = document.querySelectorAll('input, textarea, select, button, a[href], [role="button"], [role="link"], [role="checkbox"], [role="tab"], [contenteditable="true"]');
    var i = 0;
    els.forEach(function (el) {
      if (el.type === 'hidden') return;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      if (r.bottom < 0 || r.top > (window.innerHeight || 9999) + 1200) return;
      var st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return;
      var tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
      var label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || ((tag === 'a' || tag === 'button' || el.getAttribute('role')) ? el.innerText : '') || el.getAttribute('title') || el.value || '';
      el.setAttribute('data-bref', String(i));
      var f = { ref: i, kind: tag === 'input' ? (type || 'text') : tag, label: clip(label), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      if (tag === 'input' || tag === 'textarea') f.value = clip(el.value || '');
      if (type === 'checkbox' || type === 'radio') f.checked = !!el.checked;
      fields.push(f); i++;
    });
  } catch (e) {}
  return { title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 9000), fields: fields.slice(0, 120) };
}
// מבצע פעולה בדף
function _pageActor(action) {
  try {
    var byRef = function (ref) { return document.querySelector('[data-bref="' + String(ref) + '"]'); };
    var op = action && action.op;
    if (op === 'click') {
      var el = byRef(action.ref); if (!el) return { ok: false, error: 'element not found: ' + action.ref };
      el.scrollIntoView({ block: 'center' });
      var r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) { try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy })); } catch (e) {} });
      try { el.click(); } catch (e) {}
      return { ok: true };
    } else if (op === 'type') {
      var el2 = byRef(action.ref); if (!el2) return { ok: false, error: 'element not found: ' + action.ref };
      el2.focus(); var val = action.text != null ? String(action.text) : '';
      if (el2.isContentEditable) el2.textContent = val;
      else { var proto = el2.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; var setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set; if (setter) setter.call(el2, val); else el2.value = val; }
      el2.dispatchEvent(new Event('input', { bubbles: true })); el2.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    } else if (op === 'key') {
      var t2 = document.activeElement || document.body, key = action.key || 'Enter';
      ['keydown', 'keypress', 'keyup'].forEach(function (t) { try { t2.dispatchEvent(new KeyboardEvent(t, { key: key, code: key, bubbles: true })); } catch (e) {} });
      if (key === 'Enter' && t2 && t2.form) { try { t2.form.requestSubmit ? t2.form.requestSubmit() : t2.form.submit(); } catch (e) {} }
      return { ok: true };
    } else if (op === 'scroll') {
      window.scrollBy({ top: action.dir === 'up' ? -Math.round(window.innerHeight * 0.8) : Math.round(window.innerHeight * 0.8) }); return { ok: true };
    } else if (op === 'select') {
      var el3 = byRef(action.ref); if (!el3) return { ok: false, error: 'element not found' };
      var want = String(action.text || '').toLowerCase(), done = false;
      for (var k = 0; k < (el3.options || []).length; k++) { var o = el3.options[k]; if ((o.text || '').toLowerCase().indexOf(want) >= 0 || (o.value || '').toLowerCase() === want) { el3.value = o.value; done = true; break; } }
      el3.dispatchEvent(new Event('change', { bubbles: true })); return { ok: done };
    } else if (op === 'exec') {
      try { var R = (0, eval)(String(action.code || '')); return { ok: true, result: (R === undefined ? '(no return)' : (typeof R === 'object' ? JSON.stringify(R) : String(R))).slice(0, 12000) }; }
      catch (e) { return { ok: false, error: 'exec error: ' + (e && e.message || e) }; }
    }
    return { ok: false, error: 'unknown op: ' + op };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
async function _shot() {
  try { if (!workWin || workWin.isDestroyed()) return null; const img = await workWin.webContents.capturePage(); return 'data:image/jpeg;base64,' + img.toJPEG(55).toString('base64'); }
  catch (e) { return null; }
}
ipcMain.handle('birgsol-web-open', async (e, url) => {
  try { const w = _ensureWorkWin(); await w.loadURL(String(url)); try { w.show(); } catch (e2) {} await new Promise(r => setTimeout(r, 1200)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-web-look', async () => {
  try { if (!workWin || workWin.isDestroyed()) return { ok: false, error: 'no-page' }; const page = await workWin.webContents.executeJavaScript('(' + _pageReader.toString() + ')()', true); return { ok: true, ...(page || {}), console: _workConsole.slice(-25), crashed: _workCrashed, screenshot: await _shot() }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-web-act', async (e, action) => {
  try {
    if (!workWin || workWin.isDestroyed()) { if (action && action.op === 'navigate' && action.url) { _ensureWorkWin(); } else return { ok: false, error: 'no-page' }; }
    if (action && action.op === 'navigate' && action.url) { await workWin.webContents.loadURL(String(action.url)); await new Promise(r => setTimeout(r, 1400)); const page = await workWin.webContents.executeJavaScript('(' + _pageReader.toString() + ')()', true); return { ok: true, acted: true, ...(page || {}), console: _workConsole.slice(-25), crashed: _workCrashed, screenshot: await _shot() }; }
    if (action && action.op === 'wait') { await new Promise(r => setTimeout(r, Math.min(6000, action.ms || 1200))); const page = await workWin.webContents.executeJavaScript('(' + _pageReader.toString() + ')()', true); return { ok: true, acted: true, ...(page || {}), console: _workConsole.slice(-25), crashed: _workCrashed, screenshot: await _shot() }; }
    const res = await workWin.webContents.executeJavaScript('(' + _pageActor.toString() + ')(' + JSON.stringify(action || {}) + ')', true);
    if (!res || !res.ok) { const pg = await workWin.webContents.executeJavaScript('(' + _pageReader.toString() + ')()', true); return { ok: false, error: (res && res.error) || 'act failed', ...(pg || {}), screenshot: await _shot() }; }
    await new Promise(r => setTimeout(r, 900));
    const page = await workWin.webContents.executeJavaScript('(' + _pageReader.toString() + ')()', true);
    return { ok: true, acted: true, execResult: res.result != null ? res.result : null, ...(page || {}), console: _workConsole.slice(-25), crashed: _workCrashed, screenshot: await _shot() };
  } catch (err) { return { ok: false, error: err.message }; }
});

// ══════════════ גשרים לדפדפן האמיתי (דרך התוסף) — שניים נפרדים: Edge ו-Chrome במקביל ══════════════
// Edge=8137 (תואם לתוסף שפורסם בחנות), Chrome=8138. התוסף מזהה את הדפדפן ופונה לפורט הנכון;
// הדסקטופ מנתב כל פקודה לגשר של הדפדפן שנבחר בבורר.
const BRIDGE_PORTS = { edge: 8137, chrome: 8138 };
const _bridges = { edge: { queue: [], pending: {}, seen: 0 }, chrome: { queue: [], pending: {}, seen: 0 } };
let _bridgeSeq = 1;
function _bridgeEnqueue(browser, action, timeoutMs) {
  const b = _bridges[browser] || _bridges.chrome;
  return new Promise((resolve) => {
    const id = 'c' + (_bridgeSeq++);
    b.queue.push({ id, action });
    const timer = setTimeout(() => { if (b.pending[id]) { delete b.pending[id]; resolve({ ok: false, error: 'bridge-timeout' }); } }, timeoutMs || 30000);
    b.pending[id] = { resolve, timer };
  });
}
function _bridgeStartOne(browser, port) {
  try {
    const b = _bridges[browser];
    const srv = http.createServer((req, res) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      const url = req.url || '/';
      if (url.startsWith('/poll')) { b.seen = Date.now(); const next = b.queue.shift() || null; res.writeHead(200, { 'Content-Type': 'application/json', ...cors }); return res.end(JSON.stringify(next ? { cmd: next } : { none: true })); }
      if (url.startsWith('/result') && req.method === 'POST') { let body = ''; req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); }); req.on('end', () => { try { const data = JSON.parse(body || '{}'); const p = b.pending[data.id]; if (p) { clearTimeout(p.timer); delete b.pending[data.id]; p.resolve(data.result || { ok: true }); } } catch (e) {} res.writeHead(200, { 'Content-Type': 'application/json', ...cors }); res.end('{"ok":true}'); }); return; }
      if (url.startsWith('/ping')) { b.seen = Date.now(); res.writeHead(200, { 'Content-Type': 'application/json', ...cors }); return res.end('{"ok":true,"bridge":"birgsol","browser":"' + browser + '","port":' + port + '}'); }
      res.writeHead(404, cors); res.end('{}');
    });
    srv.on('error', (e) => { console.log('bridge ' + browser + ' error', e.message); });
    srv.listen(port, '127.0.0.1', () => console.log('BIRGSOL ' + browser + '-bridge on ' + port));
  } catch (e) { console.log('bridge start failed', e.message); }
}
function _bridgeStart() { _bridgeStartOne('edge', BRIDGE_PORTS.edge); _bridgeStartOne('chrome', BRIDGE_PORTS.chrome); }
function _bridgeNorm(browser) { return (browser === 'edge' || browser === 'chrome') ? browser : 'chrome'; }
ipcMain.handle('birgsol-chrome-cmd', async (e, action, browser) => {
  browser = _bridgeNorm(browser);
  const alive = (Date.now() - _bridges[browser].seen) < 6000;
  if (!alive) return { ok: false, error: 'no-ext-bridge' };
  return await _bridgeEnqueue(browser, action, (action && action.op === 'navigate') ? 20000 : 30000);
});
ipcMain.handle('birgsol-chrome-alive', async (e, browser) => {
  if (browser === 'edge' || browser === 'chrome') return { ok: true, alive: (Date.now() - _bridges[browser].seen) < 6000, browser };
  const anyAlive = (Date.now() - _bridges.edge.seen) < 6000 || (Date.now() - _bridges.chrome.seen) < 6000;
  return { ok: true, alive: anyAlive };
});
// 🚀 פתיחה/סגירה אוטומטית של הדפדפן לסוכן — פותח כשצריך, וסוגר בסוף רק את מה שהסוכן עצמו פתח.
const _browserOpenedByAgent = { edge: false, chrome: false };
ipcMain.handle('birgsol-launch-browser', async (e, browser) => {
  try {
    const cmd = (browser === 'edge') ? 'start microsoft-edge:about:blank' : 'start chrome about:blank';
    exec('cmd /c ' + cmd);
    _browserOpenedByAgent[browser] = true;
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('birgsol-close-browser', async (e, browser) => {
  try {
    if (!_browserOpenedByAgent[browser]) return { ok: true, skipped: true };
    const img = (browser === 'edge') ? 'msedge.exe' : 'chrome.exe';
    exec('taskkill /IM ' + img + ' /F');
    _browserOpenedByAgent[browser] = false;
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
