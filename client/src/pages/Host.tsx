import {useState, useRef, useEffect} from "react";
import {io, Socket} from "socket.io-client";

const resolutions = [
	{label: "720p", width: 1280, height: 720},
	{label: "1080p", width: 1920, height: 1080},
];

const fpsOptions = [24, 30, 60];

const connectSocket = (retries = 3): Promise<Socket> => {
	return new Promise((resolve, reject) => {
		let attempts = 0;
		
		const tryConnect = () => {
			attempts++;
			console.log(`Attempting to connect to socket.io server (attempt ${attempts}/${retries})`);
			
			const socket = io("http://localhost:3001", {
				reconnectionAttempts: 3,
				timeout: 5000,
				reconnectionDelay: 1000,
			});
			
			socket.on("connect", () => {
				console.log("Socket connected successfully!");
				resolve(socket);
			});
			
			socket.on("connect_error", (err) => {
				console.error("Socket connection error:", err);
				if (attempts < retries) {
					console.log(`Retrying in 1 second...`);
					socket.close();
					setTimeout(tryConnect, 1000);
				} else {
					reject(new Error(`Failed to connect after ${retries} attempts`));
				}
			});
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

	// Debug useEffect to check if we're in Electron
	useEffect(() => {
		console.log("🔍 Checking environment...");

		let debugText = "";

		// Check if we're in Electron
		const userAgent = navigator.userAgent.toLowerCase();
		if (userAgent.indexOf("electron") > -1) {
			console.log("✅ Running in Electron");
			debugText = "✅ Running in Electron";
		} else {
			console.log("❌ NOT running in Electron");
			debugText = "❌ NOT running in Electron";
		}

		// Check if mediaDevices is available
		if (navigator.mediaDevices) {
			console.log("✅ getDisplayMedia is available");
			debugText += "\n✅ getDisplayMedia API available";
		} else {
			console.log("❌ getDisplayMedia is NOT available");
			debugText += "\n❌ getDisplayMedia API NOT available";
		}

		setDebugInfo(debugText);
	}, []);
	
	const testDisplayMedia = async () => {
		try {
			console.log("🧪 Testing getDisplayMedia...");
			setDebugInfo((prev) => prev + "\n🧪 Testing getDisplayMedia...");

			// Test if we can get display media
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

			// Stop the test stream after a moment
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

			// Use the modern getDisplayMedia API
			const stream = await navigator.mediaDevices.getDisplayMedia({
				audio: true, // This will capture system audio if available
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

			// Set up WebRTC for streaming
			try {
				const socket = await connectSocket();
				socketRef.current = socket;
				
				const generatedRoomCode = Math.random().toString(36).substring(2, 8);
				setRoomCode(generatedRoomCode);
				socket.emit("join-room", generatedRoomCode);

				setDebugInfo((prev) => prev + `\n🏠 Room created: ${generatedRoomCode}`);

				socket.on("user-joined", async (viewerId: string) => {
					console.log("👤 User joined:", viewerId);
					setDebugInfo((prev) => prev + `\n👤 User joined: ${viewerId}`);

					const peer = new RTCPeerConnection({
						iceServers: [{urls: "stun:stun.l.google.com:19302"}],
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
			} catch (error) {
				console.error("Failed to connect to signaling server:", error);
				setDebugInfo(prev => prev + "\n❌ Failed to connect to signaling server. Is the server running?");
				return; // Exit the function early
			}
		} catch (error) {
			console.error("❌ Error in startStream:", error);
			if (error instanceof Error) {
				setDebugInfo((prev) => prev + `\n❌ Error: ${error.message}`);

				// Some errors may have a 'name' property
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const errName = (error as any).name;
				if (errName === "NotAllowedError") {
					setDebugInfo((prev) => prev + "\n🚫 Screen capture permission denied");
				} else if (errName === "NotFoundError") {
					setDebugInfo((prev) => prev + "\n🔍 No screen sources found");
				}
			} else {
				setDebugInfo((prev) => prev + "\n❌ Unknown error occurred");
			}
		}
	};

	const stopStream = () => {
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
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen p-4 gap-6 bg-gray-900 text-white">
			<h1 className="text-3xl font-bold">Start Your Stream</h1>

			{/* Debug Info Panel */}
			<div className="bg-gray-800 p-4 rounded-lg w-full max-w-2xl">
				<h3 className="text-lg font-semibold mb-2">Debug Info:</h3>
				<pre className="text-sm text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{debugInfo}</pre>
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
				<p className="mt-4 text-sm text-green-300">
					Share this room code: <span className="font-mono text-lg">{roomCode}</span>
				</p>
			)}

			<video id="preview" className="w-full max-w-3xl rounded-lg mt-4" autoPlay muted />
		</div>
	);
}
