const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quickSpecialTitle", {
  setTitle(data) {
    return ipcRenderer.invoke("quick-title:set", data);
  },
  api(payload) {
    return ipcRenderer.invoke("quick-title:api", payload);
  },
  debug(info) {
    return ipcRenderer.invoke("quick-title:debug", info);
  }
});
