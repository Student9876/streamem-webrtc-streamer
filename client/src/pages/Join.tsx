/* eslint-disable @typescript-eslint/no-unused-vars */
import {useState, useEffect, useRef} from "react";
import {io, Socket} from "socket.io-client";
import {useParams, useNavigate} from "react-router-dom";

export default function Join() {
	const {roomId} = useParams<{roomId: string}>();
	const navigate = useNavigate();
	const [roomCode, setRoomCode] = useState(roomId || "");
	const [status, setStatus] = useState("idle");
	const [errorMsg, setErrorMsg] = useState("");
	const socketRef = useRef<Socket | null>(null);
	const peerRef = useRef<RTCPeerConnection | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);

	// Get the server URL (same function as in Host.tsx)
	const getServerUrl = async (): Promise<string> => {
		// First try to get tunnel URL for remote access
		if (window?.electron?.getTunnelUrl) {
			try {
				const tunnelUrl = await window.electron.getTunnelUrl();
				if (typeof tunnelUrl === "string") {
					return tunnelUrl; // e.g. https://abc.loca.lt
				}
			} catch (err) {
				console.error("Failed to get tunnel URL:", err);
				// Fall back to local URL with dynamic port
			}
		}

		// Get the dynamic port set by the main process
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const port = (window as any).SERVER_PORT || 3001;
		return `http://localhost:${port}`;
	};

	// Updated lookup function to handle room lookup
	const lookupRoom = async (code: string) => {
		try {
			setStatus("looking-up");
			const response = await fetch(
				`https://apiverc.vercel.app/api/stream/lookup?roomCode=${code}`
			);

			if (!response.ok) {
				throw new Error("Room not found");
			}

			const data = await response.json();
			console.log("Room lookup data:", data);

			// If we get a response with an IP and port, use that
			if (data && data.ip) {
				let serverUrl = data.ip;

				// Make sure the URL has a protocol
				if (!serverUrl.startsWith("http")) {
					serverUrl = "https://" + serverUrl;
				}

				// Add port if it's not the default HTTPS port and it's provided
				if (data.port && data.port !== "443") {
					// Check if URL already has a port
					const url = new URL(serverUrl);
					if (!url.port) {
						serverUrl = `${serverUrl}:${data.port}`;
					}
				}

				console.log("Using server URL from room lookup:", serverUrl);
				return serverUrl;
			} else {
				// Fall back to local server if lookup doesn't provide an address
				console.log("Room found but no server details, using local server");
				return await getServerUrl();
			}
		} catch (error) {
			console.error("Room lookup failed:", error);
			// If lookup fails, try the local server
			return await getServerUrl();
		}
	};

	const joinRoom = async () => {
		if (!roomCode) {
			setErrorMsg("Please enter a room code");
			return;
		}

		try {
			setStatus("connecting");

			// First get the server URL using the room code
			const serverUrl = await lookupRoom(roomCode);
			console.log("Connecting to server:", serverUrl);

			// Initialize the socket connection
			const socket = io(serverUrl, {
				reconnectionAttempts: 5,
				timeout: 10000,
				transports: ["websocket", "polling"], // Try WebSocket first, then polling
			});

			socketRef.current = socket;

			socket.on("connect_error", (err) => {
				console.error("Socket connection error:", err);
				setErrorMsg(`Connection error: ${err.message}`);
				setStatus("error");
			});

			socket.on("connect", () => {
				console.log("Socket connected to:", serverUrl);
				socket.emit("join-room", roomCode);
				setStatus("waiting-for-stream");
			});

			// Set up WebRTC peer connection
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

			peerRef.current = peer;

			peer.ontrack = (event) => {
				console.log("Received track:", event.track.kind);
				if (videoRef.current && event.streams[0]) {
					videoRef.current.srcObject = event.streams[0];
					setStatus("streaming");
				}
			};

			peer.oniceconnectionstatechange = () => {
				console.log("ICE connection state:", peer.iceConnectionState);
				if (
					peer.iceConnectionState === "failed" ||
					peer.iceConnectionState === "disconnected"
				) {
					setStatus("error");
					setErrorMsg(
						"Connection to host failed. They may be offline or behind a firewall."
					);
				}
			};

			socket.on("offer", async ({sender, offer}) => {
				console.log("Received offer from:", sender);
				await peer.setRemoteDescription(new RTCSessionDescription(offer));
				const answer = await peer.createAnswer();
				await peer.setLocalDescription(answer);
				socket.emit("answer", {
					roomId: roomCode,
					answer,
				});
			});

			socket.on("ice-candidate", async ({candidate}) => {
				if (candidate) {
					try {
						await peer.addIceCandidate(new RTCIceCandidate(candidate));
					} catch (err) {
						console.error("Failed to add ICE candidate:", err);
					}
				}
			});
		} catch (error) {
			console.error("Error joining room:", error);
			setStatus("error");
			setErrorMsg(
				error instanceof Error ? error.message : "Failed to join room"
			);
		}
	};

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (socketRef.current) {
				socketRef.current.disconnect();
			}
			if (peerRef.current) {
				peerRef.current.close();
			}
		};
	}, []);

	// Auto-join if roomId is provided in URL
	useEffect(() => {
		if (roomId) {
			joinRoom();
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [roomId]);

	return (
		<div className="flex flex-col items-center justify-center min-h-screen p-4 gap-6 bg-gray-900 text-white">
			<h1 className="text-3xl font-bold">Join a Stream</h1>

			<div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
				<div className="mb-4">
					<label className="block text-sm mb-2">Enter Room Code</label>
					<input
						type="text"
						className="w-full p-2 bg-gray-700 rounded border border-gray-600 text-white"
						value={roomCode}
						onChange={(e) => setRoomCode(e.target.value)}
						placeholder="Enter the 6-character room code"
						disabled={status !== "idle" && status !== "error"}
					/>
				</div>

				{status === "error" && (
					<div className="p-3 mb-4 bg-red-900 text-white rounded">
						<p>Error: {errorMsg}</p>
					</div>
				)}

				{status === "waiting-for-stream" && (
					<div className="p-3 mb-4 bg-yellow-900 text-white rounded">
						<p>Waiting for stream to start...</p>
					</div>
				)}

				{status === "connecting" && (
					<div className="p-3 mb-4 bg-blue-900 text-white rounded">
						<p>Connecting to stream...</p>
					</div>
				)}

				<div className="flex gap-4">
					{(status === "idle" || status === "error") && (
						<button
							onClick={joinRoom}
							className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded text-lg flex-1"
						>
							Join Stream
						</button>
					)}

					{status !== "idle" && (
						<button
							onClick={() => {
								if (socketRef.current) socketRef.current.disconnect();
								if (peerRef.current) peerRef.current.close();
								setStatus("idle");
								setErrorMsg("");
							}}
							className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded text-lg flex-1"
						>
							Disconnect
						</button>
					)}

					<button
						onClick={() => navigate("/")}
						className="bg-gray-600 hover:bg-gray-700 px-6 py-2 rounded text-lg"
					>
						Back
					</button>
				</div>
			</div>

			<div className="w-full max-w-4xl mt-4">
				{status !== "idle" && (
					<video
						ref={videoRef}
						className="w-full rounded-lg bg-black"
						autoPlay
						playsInline
					/>
				)}
			</div>
		</div>
	);
}
