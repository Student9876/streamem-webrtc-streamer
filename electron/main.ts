const electron = require('electron');
const { app, BrowserWindow, session, ipcMain } = electron;
const path = require('path');
const { spawn, fork } = require('child_process');
const fs = require('fs');
const { desktopCapturer } = require('electron');
const https = require('https');
const http = require('http');

let mainWindow: {
    webContents: {
        on: (
            event: string,
            listener:
                | (() => void)
                | ((event: any, preloadPath: any, error: any) => void)
                | ((event: any) => void)
        ) => void;
        executeJavaScript: (arg0: string) => Promise<any>;
        openDevTools: () => void;
    };
    loadFile: (arg0: any) => void;
    on: (arg0: string, arg1: () => void) => void;
} | null = null;
let serverProcess: {
    pid(arg0: string, pid: any): unknown;
    stdout: { stderr: { on: (arg0: string, arg1: { (message: any): void; (err: any): void; (code: any): void; }) => void; kill: () => void; } | null; on: (arg0: string, arg1: { (message: any): void; (err: any): void; (code: any): void; }) => void; kill: () => void; } | null;
    stderr: { on: (arg0: string, arg1: { (message: any): void; (err: any): void; (code: any): void; }) => void; kill: () => void; } | null; on: (arg0: string, arg1: { (message: any): void; (err: any): void; (code: any): void; }) => void; kill: () => void;
} | null = null;
let tunnelProcess: { kill: () => void; stdout: { on: (arg0: string, arg1: (data: any) => void) => void; }; stderr: { on: (arg0: string, arg1: (data: any) => void) => void; }; on: (arg0: string, arg1: (code: any) => void) => void; } | null = null;
let publicTunnelUrl: unknown = null;
let serverPort = 3001; // Default port, will be updated dynamically

// Add this to your main Electron file
app.isQuitting = false;

function createWindow() {
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
            webSecurity: false,
        },
    });

    session.defaultSession.setDisplayMediaRequestHandler((request: any, callback: (arg0: { video?: any; audio?: string; }) => void) => {
        desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 150, height: 150 } })
            .then((sources: any[]) => {
                const screenSource = sources.find((source: { id: string; }) => source.id.startsWith('screen:')) || sources[0];
                if (screenSource) {
                    callback({ video: screenSource, audio: 'loopback' });
                } else {
                    callback({});
                }
            })
            .catch((error: any) => {
                console.error('❌ Error getting sources:', error);
                callback({});
            });
    }, { useSystemPicker: false });

    if (mainWindow) {
        mainWindow.webContents.on('did-finish-load', () => {
            console.log('🌐 Window loaded, setting server port:', serverPort);
            // Set server port in the renderer process
            if (mainWindow) {
                mainWindow.webContents.executeJavaScript(`window.SERVER_PORT = ${serverPort};`)
                    .catch((err: any) => console.error('Failed to set server port:', err));
            }
        });

        mainWindow.webContents.on('preload-error', (event: any, preloadPath: any, error: any) => {
            console.error('❌ Preload error:', error);
        });

        const indexPath = path.join(__dirname, "..", "client", "dist", "index.html");
        console.log('🌐 Loading HTML from:', indexPath);
        console.log('🌐 HTML exists:', fs.existsSync(indexPath));

        if (fs.existsSync(indexPath)) {
            mainWindow.loadFile(indexPath);
        }

        if (!app.isPackaged) {
            mainWindow.webContents.openDevTools();
        }

        mainWindow.on("closed", () => {
            mainWindow = null;
        });
    }
}

function startServer() {
    const isPackaged = app.isPackaged;
    let serverDir, entry;

    try {
        // IMPORTANT: Different path resolution for packaged app
        if (isPackaged) {
            // In production, the server is in resources/server/dist
            serverDir = path.join(process.resourcesPath, 'server', 'dist');
            entry = path.join(serverDir, 'index.js');

            console.log('📦 Running in production mode');
            console.log('📁 Server dir:', serverDir);
            console.log('📄 Entry file path:', entry);

            // Verify file exists
            if (!fs.existsSync(entry)) {
                console.error(`❌ Server entry file not found at: ${entry}`);

                // Debug available files
                try {
                    if (fs.existsSync(process.resourcesPath)) {
                        console.log('📂 Contents of resources directory:');
                        const resourceFiles = fs.readdirSync(process.resourcesPath);
                        console.log(resourceFiles);

                        if (fs.existsSync(path.join(process.resourcesPath, 'server'))) {
                            console.log('📂 Contents of server directory:');
                            const serverFiles = fs.readdirSync(path.join(process.resourcesPath, 'server'));
                            console.log(serverFiles);

                            if (fs.existsSync(path.join(process.resourcesPath, 'server', 'dist'))) {
                                console.log('📂 Contents of server/dist directory:');
                                const distFiles = fs.readdirSync(path.join(process.resourcesPath, 'server', 'dist'));
                                console.log(distFiles);
                            }
                        }
                    }
                } catch (err) {
                    console.error('Error listing directory contents:', err);
                }

                // Set a default port and continue without server
                serverPort = 3001;
                return;
            }
        } else {
            // In development
            const possiblePaths = [
                path.join(__dirname, '..', 'server', 'dist', 'index.js'),
                path.join(__dirname, '..', '..', 'server', 'dist', 'index.js'),
                path.join(__dirname, '..', 'server', 'src', 'index.ts'),
                path.join(__dirname, '..', '..', 'server', 'src', 'index.ts')
            ];

            entry = possiblePaths.find(p => fs.existsSync(p));

            if (!entry) {
                throw new Error("Could not find server entry file");
            }

            serverDir = path.dirname(entry);
        }

        console.log('📁 Server dir:', serverDir);
        console.log('📄 Entry:', entry);

        const isTypeScript = entry.endsWith('.ts');

        // IMPORTANT: Spawn the server process differently in production
        if (isPackaged) {
            // In production, use spawn instead of fork for better compatibility
            // The server will run as a detached process with its own stdio pipes
            serverProcess = spawn('node', [entry], {
                cwd: serverDir,
                stdio: 'pipe', // Change to 'inherit' for debugging
                windowsHide: true // Hide console window on Windows
            });

            if (serverProcess && serverProcess.stdout) {
                serverProcess.stdout.on('data', (data) => {
                    const output = data.toString().trim();
                    console.log('[Server]', output);

                    // Look for port information in the server output
                    const portMatch = output.match(/Server running on port (\d+)/);
                    if (portMatch && portMatch[1]) {
                        serverPort = parseInt(portMatch[1], 10);
                        console.log(`✅ Detected server running on port ${serverPort}`);

                        // Update the renderer if window is ready
                        if (mainWindow) {
                            mainWindow.webContents.executeJavaScript(`window.SERVER_PORT = ${serverPort};`)
                                .catch(err => console.error('Failed to set server port:', err));
                        }
                    }
                });
            }

            if (serverProcess && serverProcess.stderr) {
                serverProcess.stderr.on('data', (data) => {
                    console.error('[Server Error]', data.toString().trim());
                });
            }
        } else if (isTypeScript) {
            // Development with TypeScript
            serverProcess = fork(entry, [], {
                cwd: serverDir,
                execPath: 'npx',
                execArgv: ['ts-node'],
                stdio: ['inherit', 'inherit', 'inherit', 'ipc']
            });
        } else {
            // Development with JavaScript
            serverProcess = fork(entry, [], {
                cwd: serverDir,
                stdio: ['inherit', 'inherit', 'inherit', 'ipc']
            });
        }

        if (serverProcess) {
            console.log('✅ Server process started with PID:', serverProcess.pid);

            // For development mode with IPC
            if (!isPackaged && serverProcess.on) {
                serverProcess.on('message', (message) => {
                    if (message.type === 'server-started') {
                        serverPort = message.port;
                        console.log(`✅ Server confirmed running on port ${serverPort}`);

                        if (mainWindow) {
                            mainWindow.webContents.executeJavaScript(`window.SERVER_PORT = ${serverPort};`)
                                .catch(err => console.error('Failed to set server port:', err));
                        }
                    }
                });
            }

            serverProcess.on('error', (err) => {
                console.error('🚨 Server process error:', err);
            });

            serverProcess.on('exit', (code) => {
                console.log(`⚠️ Server process exited with code ${code}`);
                serverProcess = null;

                // Restart server if it crashes and app is still running
                if (code !== 0 && !app.isQuitting) {
                    console.log('🔄 Attempting to restart server...');
                    setTimeout(startServer, 1000);
                }
            });
        }
    } catch (err) {
        console.error('❌ Failed to start server:', err);

        // Set a default port for development
        if (!isPackaged) {
            console.warn('⚠️ Using fallback port 3001 for development');
            serverPort = 3001;
        }
    }
}

function startTunnel(port = serverPort) {
    return new Promise((resolve, reject) => {
        console.log(`🚇 Starting localtunnel for port ${port}...`);
        tunnelProcess = spawn('npx', ['localtunnel', '--port', port.toString()], { shell: true });

        if (tunnelProcess && tunnelProcess.stdout && tunnelProcess.stderr) {
            tunnelProcess.stdout.on('data', (data: { toString: () => any; }) => {
                const line = data.toString();
                console.log('[LocalTunnel]', line);
                const match = line.match(/your url is: (https:\/\/.*\.loca\.lt)/);
                if (match) {
                    publicTunnelUrl = match[1];
                    console.log('🌐 LocalTunnel URL:', publicTunnelUrl);
                    resolve(publicTunnelUrl);
                }
            });

            tunnelProcess.stderr.on('data', (data: { toString: () => any; }) => {
                console.error('[Tunnel Error]', data.toString());
            });

            tunnelProcess.on('exit', (code: any) => {
                console.warn('Tunnel process exited with code', code);
                tunnelProcess = null;
                publicTunnelUrl = null;
                reject(new Error('Tunnel process exited'));
            });
        } else {
            reject(new Error('Tunnel process failed to start'));
        }
    });
}

// Function to get public IP address
async function getPublicIpAddress(): Promise<string> {
    return new Promise((resolve, reject) => {
        // Try multiple services for reliability
        const services = [
            'https://api.ipify.org',
            'https://ipapi.co/ip',
            'https://ip.seeip.org',
            'https://api.my-ip.io/ip'
        ];

        let attempts = 0;

        const tryNextService = () => {
            if (attempts >= services.length) {
                reject(new Error('Failed to get public IP from all services'));
                return;
            }

            const serviceUrl = services[attempts];
            attempts++;

            console.log(`🌐 Trying to get public IP from: ${serviceUrl}`);

            const request = https.get(serviceUrl, (response: any) => {
                let data = '';

                response.on('data', (chunk: any) => {
                    data += chunk;
                });

                response.on('end', () => {
                    const ip = data.trim();
                    // Basic IP validation
                    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
                        console.log(`✅ Got public IP: ${ip}`);
                        resolve(ip);
                    } else {
                        console.log(`❌ Invalid IP format: ${ip}, trying next service...`);
                        tryNextService();
                    }
                });
            });

            request.on('error', (error: { message: any; }) => {
                console.log(`❌ Error getting IP from ${serviceUrl}:`, error.message);
                tryNextService();
            });

            request.setTimeout(5000, () => {
                request.destroy();
                console.log(`❌ Timeout getting IP from ${serviceUrl}`);
                tryNextService();
            });
        };

        tryNextService();
    });
}

// Add IPC handlers to expose to renderer
ipcMain.handle("get-tunnel-url", async () => {
    if (publicTunnelUrl) return publicTunnelUrl;
    return await startTunnel(serverPort);
});

ipcMain.handle("get-server-port", () => {
    return serverPort;
});

// Add IPC handler for getting public IP
ipcMain.handle("get-public-ip", async () => {
    try {
        return await getPublicIpAddress();
    } catch (error) {
        console.error('Failed to get public IP:', error);
        return 'localhost'; // Fallback
    }
});

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
    if (serverProcess) serverProcess.kill();
    if (tunnelProcess) tunnelProcess.kill();
    if (process.platform !== "darwin") app.quit();
});

app.on('ready', () => {
    console.log('🚀 Electron app is ready');
    console.log('📁 __dirname:', __dirname);
});
