const { contextBridge } = require("electron");

console.log("🔧 Preload script starting...");

// With the new approach, we don't need desktopCapturer in preload
// The main process handles the display media request
contextBridge.exposeInMainWorld("electronAPI", {
    // Add any other API methods you might need
    test: () => {
        console.log("🧪 Test method called");
        return "Test successful!";
    }
});

console.log("✅ electronAPI exposed successfully");
console.log("🔧 Preload script finished loading");