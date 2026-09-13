// גשר בטוח בין האפליקציה (BIRGSOL) לבין המערכת — נחשף כ-window.BIRGSOL_NATIVE.
// מצב הקוד/הסוכן ב-birgsolai.html בודקים אם window.BIRGSOL_NATIVE קיים → ואז יש להם כוח אמת.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BIRGSOL_NATIVE', {
  version: '1.0.0',
  isDesktop: true,
  runCommand: (cmd, cwd) => ipcRenderer.invoke('birgsol-run', cmd, cwd),   // טרמינל אמיתי (עם אישור)
  readFile:  (p)         => ipcRenderer.invoke('birgsol-readfile', p),
  writeFile: (p, c)      => ipcRenderer.invoke('birgsol-writefile', p, c),
  listDir:   (p)         => ipcRenderer.invoke('birgsol-listdir', p),
  httpFetch: (url, opt)  => ipcRenderer.invoke('birgsol-fetch', url, opt), // רשת בלי CORS
  info:      ()          => ipcRenderer.invoke('birgsol-info')
});
