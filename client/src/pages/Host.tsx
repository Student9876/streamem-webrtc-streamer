import {useState, useRef, useEffect} from "react";
import {io, Socket} from "socket.io-client";

// Fixed and more comprehensive type declarations
declare global {
	interface Window {
		electron?: {
			getTunnelUrl(): Promise<string>;
			getSources: () => Promise<unknown[]>;
		};
		electronAPI?: {
			getTunnelUrl(): Promise<string>;
			getServerPort(): Promise<number>;
			getSources: () => Promise<unknown[]>;
			test: () => string;
			getPublicIp(): Promise<string>;
		};
		SERVER_PORT?: number;
	}
}

const resolutions = [
	{label: "720p", width: 1280, height: 720},
	{label: "1080p", width: 1920, height: 1080},
];

const fpsOptions = [24, 30, 60];

// Fixed getServerUrl function with better error handling
const getServerUrl = async (): Promise<string> => {
	let serverUrl = "http://localhost:3001"; // Default fallback

	try {
		// First try to get tunnel URL for remote access
		if (window?.electronAPI?.getTunnelUrl) {
			console.log("🔍 Attempting to get tunnel URL...");
			const tunnelUrl = await window.electronAPI.getTunnelUrl();
			if (tunnelUrl && typeof tunnelUrl === "string" && tunnelUrl.trim() !== "") {
				console.log("✅ Got tunnel URL:", tunnelUrl);
				return tunnelUrl;
			}
		}

		// Try alternative electron interface
		if (window?.electron?.getTunnelUrl) {
			console.log("🔍 Attempting to get tunnel URL via electron interface...");
			const tunnelUrl = await window.electron.getTunnelUrl();
			if (tunnelUrl && typeof tunnelUrl === "string" && tunnelUrl.trim() !== "") {
				console.log("✅ Got tunnel URL via electron:", tunnelUrl);
				return tunnelUrl;
			}
		}

		console.log("⚠️ No tunnel URL available, using local server");

		// Get the dynamic port from electronAPI
		if (window?.electronAPI?.getServerPort) {
			try {
				const port = await window.electronAPI.getServerPort();
				if (port && typeof port === "number" && port > 0) {
					serverUrl = `http://localhost:${port}`;
					console.log("✅ Got server port from electronAPI:", port);
				}
			} catch (portError) {
				console.warn("Failed to get server port from electronAPI:", portError);
			}
		}

		// Fallback to window.SERVER_PORT
		if (serverUrl === "http://localhost:3001" && window.SERVER_PORT) {
			serverUrl = `http://localhost:${window.SERVER_PORT}`;
			console.log("✅ Using SERVER_PORT from window:", window.SERVER_PORT);
		}
	} catch (error) {
		console.error("Error getting server URL:", error);
	}

	console.log("🔌 Final server URL:", serverUrl);
	return serverUrl;
};

// Fixed registerRoom function with better error handling
const registerRoom = async (roomCode: string, serverUrl: string) => {
	let ip = "localhost";
	let port = "3001";

	try {
		console.log("📝 Starting room registration for:", roomCode);

		// Check if serverUrl is a tunnel URL
		if (serverUrl.includes(".loca.lt") || serverUrl.includes("ngrok") || serverUrl.includes("tunnelmole")) {
			console.log("🌐 Using tunnel URL for registration");
			const url = new URL(serverUrl);
			ip = url.hostname;
			port = url.port || (url.protocol === "https:" ? "443" : "80");
		} else {
			console.log("🏠 Using local server, attempting to get public IP");

			// Try to get public IP
			if (window?.electronAPI?.getPublicIp) {
				try {
					const publicIp = await window.electronAPI.getPublicIp();
					if (publicIp && typeof publicIp === "string" && publicIp.trim() !== "") {
						ip = publicIp;
						console.log("✅ Got public IP:", ip);
					} else {
						console.warn("⚠️ getPublicIp returned empty/invalid value");
					}
				} catch (ipError) {
					console.error("❌ Failed to get public IP:", ipError);
				}
			} else {
				console.warn("⚠️ getPublicIp method not available");
			}

			// Extract port from serverUrl
			try {
				const url = new URL(serverUrl);
				port = url.port || "3001";
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
			} catch (urlError) {
				// If serverUrl isn't a valid URL, extract port differently
				const portMatch = serverUrl.match(/:(\d+)/);
				port = portMatch ? portMatch[1] : "3001";
			}
		}

		console.log(`📤 Registering room ${roomCode} with IP: ${ip}, Port: ${port}`);

		// Register with the API service
		const response = await fetch("https://apiverc.vercel.app/api/stream/register", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({roomCode, ip, port}),
		});

		if (!response.ok) {
			throw new Error(`Registration failed with status: ${response.status}`);
		}

		console.log(`✅ Room ${roomCode} registered successfully`);
	} catch (error) {
		console.error("❌ Failed to register room:", error);
		throw error;
	}
};

// Fixed connectSocket function with better retry logic
const connectSocket = (retries = 3): Promise<Socket> => {
	// eslint-disable-next-line no-async-promise-executor
	return new Promise(async (resolve, reject) => {
		let attempts = 0;

		const tryConnect = async () => {
			attempts++;

			try {
				const serverUrl = await getServerUrl();
				console.log(`🔌 Attempting socket connection to ${serverUrl} (attempt ${attempts}/${retries})`);

				const socket = io(serverUrl, {
					reconnectionAttempts: 3,
					timeout: 10000, // Increased timeout
					reconnectionDelay: 1000,
					transports: ["websocket", "polling"], // Allow fallback to polling
				});

				// Set up event handlers
				const onConnect = () => {
					console.log("✅ Socket connected successfully!");
					socket.off("connect_error", onConnectError);
					resolve(socket);
				};

				const onConnectError = (err: Error) => {
					console.error(`❌ Socket connection error (attempt ${attempts}):`, err.message);

					if (attempts < retries) {
						console.log(`🔄 Retrying in 2 seconds...`);
						socket.close();
						setTimeout(() => tryConnect(), 2000);
					} else {
						socket.close();
						reject(new Error(`Failed to connect to ${serverUrl} after ${retries} attempts. Last error: ${err.message}`));
					}
				};

				socket.once("connect", onConnect);
				socket.once("connect_error", onConnectError);
			} catch (urlError) {
				console.error("Failed to get server URL:", urlError);
				if (attempts < retries) {
					setTimeout(() => tryConnect(), 2000);
				} else {
					reject(new Error(`Failed to get server URL after ${retries} attempts`));
				}
			}
		};

		tryConnect();
	});
};

export default function Host() {
	const [resolution, setResolution] = useState(resolutions[1]);
	const [fps, setFps] = useState(30);
	const [roomCode, setRoomCode] = useState<string | null>(null);
	const [debugInfo, setDebugInfo] = useState<string>("");

	const socketRef = useRef<Socket | null>(null);
	const peerConnections = useRef<{[id: string]: RTCPeerConnection}>({});
	const streamRef = useRef<MediaStream | null>(null);

	// Enhanced debug useEffect with more comprehensive checks
	useEffect(() => {
		const checkEnvironment = async () => {
			console.log("🔍 Starting environment check...");
			let debugText = "=== ENVIRONMENT CHECK ===\n";

			// Check if running in Electron
			const userAgent = navigator.userAgent.toLowerCase();
			const isElectron = userAgent.indexOf("electron") > -1;
			debugText += isElectron ? "✅ Running in Electron\n" : "❌ NOT running in Electron\n";

			// Check available APIs
			if (window.electronAPI) {
				debugText += "✅ window.electronAPI is available\n";

				// Test individual methods
				if (typeof window.electronAPI.getTunnelUrl === "function") {
					debugText += "  ✅ getTunnelUrl method exists\n";
				} else {
					debugText += "  ❌ getTunnelUrl method missing\n";
				}

				if (typeof window.electronAPI.getServerPort === "function") {
					debugText += "  ✅ getServerPort method exists\n";
				} else {
					debugText += "  ❌ getServerPort method missing\n";
				}

				if (typeof window.electronAPI.getPublicIp === "function") {
					debugText += "  ✅ getPublicIp method exists\n";
				} else {
					debugText += "  ❌ getPublicIp method missing\n";
				}
			} else {
				debugText += "❌ window.electronAPI is NOT available\n";
			}

			if (window.electron) {
				debugText += "✅ window.electron is available\n";
			} else {
				debugText += "❌ window.electron is NOT available\n";
			}

			// Check SERVER_PORT
			if (window.SERVER_PORT) {
				debugText += `✅ window.SERVER_PORT: ${window.SERVER_PORT}\n`;
			} else {
				debugText += "❌ window.SERVER_PORT not set\n";
			}

			// Check media capabilities
			if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function") {
				debugText += "✅ getDisplayMedia API available\n";
			} else {
				debugText += "❌ getDisplayMedia API NOT available\n";
			}

			// Test server connection
			debugText += "\n=== SERVER CHECK ===\n";
			try {
				const serverUrl = await getServerUrl();
				debugText += `🔌 Server URL: ${serverUrl}\n`;

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 5000);

				const response = await fetch(`${serverUrl}/api/status`, {
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (response.ok) {
					debugText += "✅ Server is responding\n";
					const data = await response.text();
					if (data) {
						debugText += `📄 Server response: ${data.substring(0, 100)}\n`;
					}
				} else {
					debugText += `⚠️ Server returned status: ${response.status}\n`;
				}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} catch (error: any) {
				if (error.name === "AbortError") {
					debugText += "❌ Server connection timed out\n";
				} else {
					debugText += `❌ Server check failed: ${error.message}\n`;
				}
			}

			setDebugInfo(debugText);
		};

		checkEnvironment();
	}, []);

	const testDisplayMedia = async () => {
		try {
			console.log("🧪 Testing getDisplayMedia...");
			setDebugInfo((prev) => prev + "\n🧪 Testing getDisplayMedia...");

			const stream = await navigator.mediaDevices.getDisplayMedia({
				audio: true,
				video: {
					width: {ideal: resolution.width},
					height: {ideal: resolution.height},
					frameRate: {ideal: fps},
				},
			});

			console.log("✅ getDisplayMedia test successful!", stream);
			setDebugInfo((prev) => prev + "\n✅ Screen capture test successful!");
			setDebugInfo((prev) => prev + `\n📹 Stream tracks: ${stream.getTracks().length}`);

			// Show preview
			const videoEl = document.getElementById("preview") as HTMLVideoElement;
			if (videoEl) {
				videoEl.srcObject = stream;
				videoEl.play();
			}

			// Stop the test stream after 3 seconds
			setTimeout(() => {
				stream.getTracks().forEach((track) => track.stop());
				if (videoEl) {
					videoEl.srcObject = null;
				}
				setDebugInfo((prev) => prev + "\n🛑 Test stream stopped");
			}, 3000);
		} catch (error) {
			console.error("❌ getDisplayMedia test failed:", error);
			setDebugInfo((prev) => prev + `\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	const startStream = async () => {
		try {
			console.log("🎬 Starting stream...");
			setDebugInfo((prev) => prev + "\n🎬 Starting stream...");

			const serverUrl = await getServerUrl();
			setDebugInfo((prev) => prev + `\n🔌 Using server: ${serverUrl}`);

			// Get display stream
			const stream = await navigator.mediaDevices.getDisplayMedia({
				audio: true,
				video: {
					width: {ideal: resolution.width},
					height: {ideal: resolution.height},
					frameRate: {ideal: fps},
				},
			});

			console.log("📹 Got display stream:", stream);
			setDebugInfo((prev) => prev + "\n📹 Screen capture successful!");

			streamRef.current = stream;
			const videoEl = document.getElementById("preview") as HTMLVideoElement;
			if (videoEl) {
				videoEl.srcObject = stream;
				videoEl.play();
			}

			// Set up WebRTC streaming
			try {
				setDebugInfo((prev) => prev + "\n🔌 Connecting to signaling server...");
				const socket = await connectSocket();
				socketRef.current = socket;

				const generatedRoomCode = Math.random().toString(36).substring(2, 8);
				setRoomCode(generatedRoomCode);
				socket.emit("join-room", generatedRoomCode);

				setDebugInfo((prev) => prev + `\n🏠 Room created: ${generatedRoomCode}`);

				// Register the room
				try {
					setDebugInfo((prev) => prev + "\n📝 Registering room...");
					await registerRoom(generatedRoomCode, serverUrl);
					setDebugInfo((prev) => prev + `\n✅ Room registered: ${generatedRoomCode}`);
				} catch (regError) {
					console.error("Failed to register room:", regError);
					setDebugInfo((prev) => prev + `\n⚠️ Room registration failed: ${regError instanceof Error ? regError.message : String(regError)}`);
				}

				// WebRTC signaling handlers
				socket.on("user-joined", async (viewerId: string) => {
					console.log("👤 User joined:", viewerId);
					setDebugInfo((prev) => prev + `\n👤 User joined: ${viewerId}`);

					const peer = new RTCPeerConnection({
						iceServers: [
							{urls: "stun:stun.l.google.com:19302"},
							{
								urls: "turn:openrelay.metered.ca:80",
								username: "openrelayproject",
								credential: "openrelayproject",
							},
						],
					});

					stream.getTracks().forEach((track) => {
						peer.addTrack(track, stream);
					});

					peer.onicecandidate = (event) => {
						if (event.candidate) {
							socket.emit("ice-candidate", {
								roomId: generatedRoomCode,
								candidate: event.candidate,
							});
						}
					};

					const offer = await peer.createOffer();
					await peer.setLocalDescription(offer);
					socket.emit("offer", {
						roomId: generatedRoomCode,
						offer,
					});

					peerConnections.current[viewerId] = peer;
				});

				socket.on("answer", async ({sender, answer}) => {
					const pc = peerConnections.current[sender];
					if (pc) {
						await pc.setRemoteDescription(new RTCSessionDescription(answer));
					}
				});

				socket.on("ice-candidate", async ({sender, candidate}) => {
					const pc = peerConnections.current[sender];
					if (pc && candidate) {
						try {
							await pc.addIceCandidate(new RTCIceCandidate(candidate));
						} catch (err) {
							console.error("Failed to add ICE candidate", err);
						}
					}
				});
			} catch (socketError) {
				console.error("Failed to connect to signaling server:", socketError);
				setDebugInfo(
					(prev) => prev + `\n❌ Signaling server connection failed: ${socketError instanceof Error ? socketError.message : String(socketError)}`
				);

				// Clean up stream if socket connection failed
				stream.getTracks().forEach((track) => track.stop());
				streamRef.current = null;
				return;
			}
		} catch (error) {
			console.error("❌ Error in startStream:", error);
			setDebugInfo((prev) => prev + `\n❌ Stream start failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	const stopStream = () => {
		console.log("🛑 Stopping stream...");

		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;

			const videoEl = document.getElementById("preview") as HTMLVideoElement;
			if (videoEl) {
				videoEl.srcObject = null;
			}

			setRoomCode(null);
			setDebugInfo((prev) => prev + "\n🛑 Stream stopped");
		}

		if (socketRef.current) {
			socketRef.current.disconnect();
			socketRef.current = null;
		}

		// Close all peer connections
		Object.values(peerConnections.current).forEach((pc) => pc.close());
		peerConnections.current = {};

		console.log("✅ Stream cleanup completed");
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen p-4 gap-6 bg-gray-900 text-white">
			<h1 className="text-3xl font-bold">Start Your Stream</h1>

			{/* Enhanced Debug Info Panel */}
			<div className="bg-gray-800 p-4 rounded-lg w-full max-w-4xl">
				<h3 className="text-lg font-semibold mb-2">Debug Info:</h3>
				<pre className="text-sm text-gray-300 whitespace-pre-wrap max-h-60 overflow-y-auto font-mono">{debugInfo}</pre>
			</div>

			<div className="flex gap-4">
				<div>
					<label className="block text-sm mb-1">Resolution</label>
					<select
						className="bg-gray-800 p-2 rounded"
						value={resolution.label}
						onChange={(e) => setResolution(resolutions.find((r) => r.label === e.target.value) || resolutions[0])}>
						{resolutions.map((r) => (
							<option key={r.label} value={r.label}>
								{r.label}
							</option>
						))}
					</select>
				</div>

				<div>
					<label className="block text-sm mb-1">FPS</label>
					<select className="bg-gray-800 p-2 rounded" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
						{fpsOptions.map((f) => (
							<option key={f} value={f}>
								{f} FPS
							</option>
						))}
					</select>
				</div>
			</div>

			<div className="flex gap-4">
				<button onClick={testDisplayMedia} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded text-lg">
					Test Screen Capture
				</button>

				<button onClick={startStream} className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded text-lg">
					Start Stream
				</button>

				<button onClick={stopStream} className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded text-lg">
					Stop Stream
				</button>
			</div>

			{roomCode && (
				<div className="mt-4 p-4 bg-green-900 rounded-lg">
					<p className="text-sm text-green-300">
						Share this room code: <span className="font-mono text-lg font-bold">{roomCode}</span>
					</p>
				</div>
			)}

			<video id="preview" className="w-full max-w-3xl rounded-lg mt-4" autoPlay muted />
		</div>
	);
}
