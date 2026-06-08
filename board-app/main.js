const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {}
    return {};
}

function saveConfig(config) {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {}
}

const CONNECTION_LOST_HTML = `
<!DOCTYPE html><html><head><style>
  body { font-family: Arial, sans-serif; display: flex; align-items: center;
         justify-content: center; height: 100vh; background: #111; margin: 0; }
  .box { background: #222; border: 3px solid #555; padding: 40px; text-align: center; color: white; }
  h2 { margin-bottom: 12px; }
  p  { color: #aaa; margin-bottom: 20px; }
  button { padding: 12px 24px; font-size: 15px; font-weight: bold;
           background: white; color: black; border: none; cursor: pointer; }
  button:hover { background: #ddd; }
</style></head><body>
<div class="box">
  <h2>Connection Lost</h2>
  <p>Could not reach the whiteboard server.<br>Make sure the server computer is on and running.</p>
  <button onclick="location.reload()">Try Again</button>
</div></body></html>`;

function createSetupWindow() {
    const win = new BrowserWindow({
        width: 500,
        height: 380,
        resizable: false,
        title: 'Whiteboard',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html><html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; background: #f0f0f0; display: flex;
         align-items: center; justify-content: center; height: 100vh; padding: 30px; }
  .card { background: white; border: 3px solid black; padding: 30px; width: 100%; text-align: center; }
  h2 { margin-bottom: 10px; font-size: 20px; }
  p  { color: #555; font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
  input { width: 100%; padding: 10px; font-size: 15px; border: 2px solid #ccc;
          margin-bottom: 14px; text-align: center; }
  input:focus { outline: none; border-color: #333; }
  .btn { width: 100%; padding: 12px; font-size: 15px; font-weight: bold;
         border: none; cursor: pointer; margin-bottom: 10px; }
  .btn-editor  { background: #222; color: white; }
  .btn-editor:hover  { background: #444; }
  .btn-display { background: #fff; color: #222; border: 2px solid #222; }
  .btn-display:hover { background: #f0f0f0; }
  .error { color: red; font-size: 13px; margin-top: 6px; display: none; }
</style></head><body>
<div class="card">
  <h2>Whiteboard</h2>
  <p>Enter the server IP and this computer's name.</p>
  <input type="text" id="ip" placeholder="Server IP e.g. 192.168.1.10" autofocus />
  <input type="text" id="pcname" placeholder="This PC name e.g. Pharmacy" style="margin-bottom:14px" />
  <button class="btn btn-editor"  onclick="connect('editor')">Open Editor</button>
  <button class="btn btn-display" onclick="connect('display')">Open Display Screen</button>
  <div class="error" id="error">Could not connect. Check the IP and try again.</div>
  <div class="error" id="nameerror" style="display:none;color:#c80;">Please enter a name for this PC.</div>
</div>
<script>
  const { ipcRenderer } = require('electron');
  ipcRenderer.invoke('get-last-config').then(cfg => {
    if (cfg.ip) document.getElementById('ip').value = cfg.ip;
    if (cfg.pcName) document.getElementById('pcname').value = cfg.pcName;
  });
  document.getElementById('ip').addEventListener('keydown', e => { if (e.key === 'Enter') connect('editor'); });
  document.getElementById('pcname').addEventListener('keydown', e => { if (e.key === 'Enter') connect('editor'); });
  function connect(mode) {
    const ip = document.getElementById('ip').value.trim();
    const pcName = document.getElementById('pcname').value.trim();
    if (!ip) return;
    if (!pcName) { document.getElementById('nameerror').style.display = 'block'; return; }
    document.getElementById('error').style.display = 'none';
    document.getElementById('nameerror').style.display = 'none';
    ipcRenderer.send('try-connect', { ip, mode, pcName });
  }
  ipcRenderer.on('connect-failed', () => { document.getElementById('error').style.display = 'block'; });
</script></body></html>
`)}`)

    return win;
}

function createEditorWindow(serverUrl, pcName = 'Unknown') {
    const win = new BrowserWindow({
        width: 1400, height: 900, title: 'Whiteboard — Editor',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    win.maximize();
    win.loadURL(`${serverUrl}/board.html?mode=editor&pc=${encodeURIComponent(pcName)}`);
    win.webContents.on('did-fail-load', () => {
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CONNECTION_LOST_HTML)}`);
    });
    return win;
}

function createDisplayWindow(serverUrl, pcName = 'Unknown') {
    const win = new BrowserWindow({
        width: 1400, height: 900, title: 'Whiteboard — Display',
        autoHideMenuBar: true,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    win.loadURL(`${serverUrl}/board.html?mode=board&pc=${encodeURIComponent(pcName)}`);

    // Wait for page to fully load before showing, then go fullscreen
    win.webContents.on('did-finish-load', () => {
        win.maximize();
        win.show();
        win.setFullScreen(true);
    });

    win.webContents.on('did-fail-load', () => {
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CONNECTION_LOST_HTML)}`);
        win.show();
    });

    // ESC exits fullscreen but keeps window open
    win.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') win.setFullScreen(false);
    });

    return win;
}

app.whenReady().then(() => {
    const config = loadConfig();

    ipcMain.handle('get-last-ip', () => config.lastIp || '');
    ipcMain.handle('get-last-config', () => ({ ip: config.lastIp || '', pcName: config.pcName || '' }));

    ipcMain.on('try-connect', async (event, { ip, mode, pcName }) => {
        const url = `http://${ip}:3000`;
        try {
            const http = require('http');
            await new Promise((resolve, reject) => {
                const req = http.get(url, { timeout: 3000 }, resolve);
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            });

            config.lastIp = ip;
            config.pcName = pcName || 'Unknown';
            saveConfig(config);

            const setupWin = BrowserWindow.getAllWindows()[0];
            if (mode === 'display') {
                createDisplayWindow(url, config.pcName);
            } else {
                createEditorWindow(url, config.pcName);
            }
            setupWin.close();

        } catch (e) {
            event.sender.send('connect-failed');
        }
    });

    // Always show setup — IP is pre-filled if saved, user picks editor or display
    createSetupWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
