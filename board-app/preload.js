const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    updateBlock: (data) => ipcRenderer.send('update-block', data),
    onUpdateBlock: (callback) =>
        ipcRenderer.on('update-block', (event, data) => callback(data))
});