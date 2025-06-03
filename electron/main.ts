import { desktopCapturer } from "electron";

// Use a require statement instead of ES import for Electron
const electron = require('electron');
const { app, BrowserWindow, session } = electron;
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let serverProcess: { on: (arg0: string, arg1: { (err: any): void; (code: any): void; }) => void; kill: () => void; } | null = null;

function createWindow() {
    // Log the preload path to debug
    const preloadPath = path.join(__dirname, 'preload.js');
    console.log('🔧 Preload path:', preloadPath);
    console.log('🔧 Preload exists:', fs.existsSync(preloadPath));

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: preloadPath,
            webSecurity: false, // You might need this for development
        },
    });

    // Set up the display media request handler for screen capture
    session.defaultSession.setDisplayMediaRequestHandler((request: any, callback: (arg0: { video?: any; audio?: string; }) => void) => {
        console.log('🎥 Display media request received');

        desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 150, height: 150 }
        }).then((sources: any[]) => {
            console.log('📱 Found', sources.length, 'sources');

            // You can implement source selection logic here
            // For now, let's grant access to the first screen found
            const screenSource = sources.find((source: { id: string; }) => source.id.startsWith('screen:')) || sources[0];

            if (screenSource) {
                console.log('✅ Granting access to:', screenSource.name);
                callback({
                    video: screenSource,
                    audio: 'loopback' // This enables system audio capture
                });
            } else {
                console.log('❌ No suitable source found');
                callback({});
            }
        }).catch((error: any) => {
            console.error('❌ Error getting sources:', error);
            callback({});
        });
    }, {
        useSystemPicker: false // Set to true if you want to use system picker
    });

    // Add this to see if preload is loading
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('✅ Window finished loading');
    });

    mainWindow.webContents.on('preload-error', (event: any, preloadPath: any, error: any) => {
        console.error('❌ Preload error:', error);
    });

    // In production, load from local file
    const indexPath = path.join(__dirname, "..", "client", "dist", "index.html");
    console.log('🌐 Loading HTML from:', indexPath);
    console.log('🌐 HTML exists:', fs.existsSync(indexPath));

    mainWindow.loadFile(indexPath);

    // Open DevTools for debugging (remove in production)
    mainWindow.webContents.openDevTools();

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

function startServer() {
    const isPackaged = app.isPackaged;
    const serverDir = isPackaged
        ? path.join(process.resourcesPath, 'server')
        : path.join(__dirname, '..', '..', 'server');

    const entry = isPackaged
        ? path.join(serverDir, 'dist', 'index.js')
        : path.join(serverDir, 'src', 'index.ts');

    console.log("📁 Server dir:", serverDir);
    console.log("📄 Entry:", entry);

    try {
        serverProcess = isPackaged
            ? spawn('node', [entry], {
                cwd: serverDir,
                stdio: 'inherit',
                shell: true
            })
            : spawn('npx', ['ts-node', entry], {
                cwd: serverDir,
                stdio: 'inherit',
                shell: true
            });

        if (serverProcess) {
            serverProcess.on('error', (err) => {
                console.error("🚨 Server error:", err);
            });

            serverProcess.on('exit', (code) => {
                console.warn("⚠️ Server exited with code:", code);
            });
        }
    } catch (err) {
        console.error("🔥 Failed to start server:", err);
    }
}



app.whenReady().then(() => {
    startServer();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (serverProcess) {
        console.log('Killing server process');
        serverProcess.kill();
    }
    if (process.platform !== "darwin") app.quit();
});

// Add this for debugging
app.on('ready', () => {
    console.log('🚀 Electron app is ready');
    console.log('📁 __dirname:', __dirname);
});