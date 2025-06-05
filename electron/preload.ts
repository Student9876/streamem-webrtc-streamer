const { contextBridge, ipcRenderer } = require("electron");

console.log("🔧 Preload script starting...");

contextBridge.exposeInMainWorld("electronAPI", {
    getTunnelUrl: () => ipcRenderer.invoke("get-tunnel-url"),
    getServerPort: () => ipcRenderer.invoke("get-server-port"),
    getPublicIp: () => ipcRenderer.invoke("get-public-ip"),
    test: () => {
        console.log("🧪 Test method called");
        return "Test successful!";
    }
});

console.log("✅ electronAPI exposed successfully");
console.log("🔧 Preload script finished loading");