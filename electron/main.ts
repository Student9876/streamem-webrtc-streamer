// Import required modules
const electron = require('electron');
const { app, BrowserWindow, session, ipcMain } = electron;
const path = require('path');
const { spawn, fork } = require('child_process');
const fs = require('fs');
const { desktopCapturer } = require('electron');

let mainWindow: { webContents: { on: (event: string, listener: (...args: any[]) => void) => void; openDevTools: () => void; executeJavaScript: (arg0: string) => Promise<any>; }; loadFile: (arg0: any) => void; on: (arg0: string, arg1: () => void) => void; } | null = null;
import { ChildProcess, ChildProcessWithoutNullStreams } from 'child_process';

let serverProcess: ChildProcess | null = null;
let serverPort = 3000; // Default port, will be updated

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
    if (mainWindow) {
        mainWindow.webContents.on('did-finish-load', () => {
            console.log('✅ Window finished loading');
        });

        mainWindow.webContents.on('preload-error', (event: any, preloadPath: any, error: any) => {
            console.error('❌ Preload error:', error);
        });
    }

    // In production, load from local file
    const indexPath = path.join(__dirname, "..", "client", "dist", "index.html");
    console.log('🌐 Loading HTML from:', indexPath);
    console.log('🌐 HTML exists:', fs.existsSync(indexPath));

    if (mainWindow) {
        mainWindow.loadFile(indexPath);
    }

    // Disable DevTools in production
    if (!app.isPackaged && mainWindow) {
        mainWindow.webContents.openDevTools();
    }

    // Expose the server port to the renderer process
    if (mainWindow) {
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow!.webContents.executeJavaScript(`window.SERVER_PORT = ${serverPort};`)
                .catch(err => console.error('Failed to set server port:', err));
        });
    }

    if (mainWindow) {
        mainWindow.on("closed", () => {
            mainWindow = null;
        });
    }
}

function findNodeExecutable() {
    // Try to find Node.js executable
    const possiblePaths = [
        process.execPath, // Current Node.js executable
        'node',
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
        path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
    ];

    for (const nodePath of possiblePaths) {
        try {
            if (fs.existsSync(nodePath)) {
                return nodePath;
            }
        } catch (e) {
            // Continue to next path
        }
    }

    return 'node'; // Fallback
}

function findTsNodePath() {
    // Try to find ts-node executable
    const possiblePaths = [
        path.join(__dirname, '..', '..', 'node_modules', '.bin', 'ts-node'),
        path.join(__dirname, '..', '..', 'node_modules', '.bin', 'ts-node.cmd'),
        path.join(process.cwd(), 'node_modules', '.bin', 'ts-node'),
        path.join(process.cwd(), 'node_modules', '.bin', 'ts-node.cmd'),
    ];

    for (const tsNodePath of possiblePaths) {
        if (fs.existsSync(tsNodePath)) {
            return tsNodePath;
        }
    }

    return null;
}

function startServer() {
    const serverPath = path.join(__dirname, '..', 'server', 'dist', 'index.js');

    if (!fs.existsSync(serverPath)) {
        console.error('Server file not found at:', serverPath);
        return;
    }

    serverProcess = fork(serverPath, [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    if (serverProcess) {
        serverProcess.on('error', console.error);
        serverProcess.on('exit', (code) => console.log('Server exit:', code));
    }
}

// Add a flag to track intentional quit
app.isQuitting = false;

app.whenReady().then(() => {
    startServer();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("before-quit", () => {
    app.isQuitting = true;
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