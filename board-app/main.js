const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let boardWindow;
let editorWindow;

function createWindows() {

    // Board Window (Display Only)
    boardWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        }
    });

    boardWindow.loadFile('board.html', {
        query: { mode: "board" }
    });


    // Editor Window (Interactive)
    editorWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        parent: boardWindow,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        }
    });

    editorWindow.loadFile('board.html', {
        query: { mode: "editor" }
    });
}

app.whenReady().then(createWindows);

ipcMain.on('update-block', (event, data) => {
    boardWindow.webContents.send('update-block', data);
});