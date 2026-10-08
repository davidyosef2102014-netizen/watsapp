// גשר בטוח בין האפליקציה (BIRGSOL) לבין המערכת — נחשף כ-window.BIRGSOL_NATIVE.
// מצב הקוד/הסוכן ב-birgsolai.html בודקים אם window.BIRGSOL_NATIVE קיים → ואז יש להם כוח אמת.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BIRGSOL_NATIVE', {
  version: '1.4.0',
  isDesktop: true,
  hasWebControl: true,     // שליטת-דפדפן נייטיבית (חלון-עבודה)
  hasChromeBridge: true,   // גשר לכרום האמיתי של המשתמש דרך התוסף
  runCommand: (cmd, cwd) => ipcRenderer.invoke('birgsol-run', cmd, cwd),   // טרמינל — שרתים רצים ברקע אוטומטית
  readFile:  (p)         => ipcRenderer.invoke('birgsol-readfile', p),
  writeFile: (p, c)      => ipcRenderer.invoke('birgsol-writefile', p, c),
  deleteFile:(p)         => ipcRenderer.invoke('birgsol-deletefile', p), // מחיקה בטוחה (סוגר streams)
  listDir:   (p)         => ipcRenderer.invoke('birgsol-listdir', p),
  killPort:  (port)      => ipcRenderer.invoke('birgsol-killport', port), // שחרור פורט תפוס
  killBg:    ()          => ipcRenderer.invoke('birgsol-killbg'),         // עצירת כל שרתי-הרקע
  httpFetch: (url, opt)  => ipcRenderer.invoke('birgsol-fetch', url, opt), // רשת בלי CORS
  nvidiaChat:(payload)   => ipcRenderer.invoke('birgsol-nvidia-chat', payload), // GLM-5.3 מלא, מפתח מקומי מוזרק בתהליך הראשי
  info:      ()          => ipcRenderer.invoke('birgsol-info'),
  confirm:   (message, opts) => ipcRenderer.invoke('birgsol-confirm', message, opts), // חלון-אישור נייטיב (רק לפעולות חשובות)
  // שליטת-דפדפן נייטיבית (חלון-עבודה)
  webOpen:   (url)       => ipcRenderer.invoke('birgsol-web-open', url),
  webLook:   ()          => ipcRenderer.invoke('birgsol-web-look'),
  webAct:    (action)    => ipcRenderer.invoke('birgsol-web-act', action),
  // גשר לכרום האמיתי של המשתמש דרך התוסף (שרת מקומי)
  chromeCmd:   (action, browser) => ipcRenderer.invoke('birgsol-chrome-cmd', action, browser), // browser: 'chrome' | 'edge'
  chromeAlive: (browser)          => ipcRenderer.invoke('birgsol-chrome-alive', browser),
  launchBrowser: (browser)        => ipcRenderer.invoke('birgsol-launch-browser', browser), // פותח את הדפדפן לסוכן
  closeBrowser:  (browser)        => ipcRenderer.invoke('birgsol-close-browser', browser)   // סוגר רק מה שהסוכן פתח
});
