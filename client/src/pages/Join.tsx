import {useState, useRef} from "react";
import {io, Socket} from "socket.io-client";

export default function Join() {
	const [roomCode, setRoomCode] = useState("");
	const [joined, setJoined] = useState(false);
	const socketRef = useRef<Socket | null>(null);
	const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);

	const joinRoom = () => {
		const socket = io("http://localhost:3001");
		socketRef.current = socket;

		socket.emit("join-room", roomCode);
		setJoined(true);

		const pc = new RTCPeerConnection({
			iceServers: [{urls: "stun:stun.l.google.com:19302"}],
		});

		peerConnectionRef.current = pc;

		pc.ontrack = (event) => {
			const [stream] = event.streams;
			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				videoRef.current.play();
			}
		};

		// Send answer to host
		socket.on("offer", async ({sender, offer}) => {
			await pc.setRemoteDescription(new RTCSessionDescription(offer));
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			console.log(`Sending answer to ${sender}`);
			socket.emit("answer", {
				roomId: roomCode,
				answer,
			});
		});

		// Add ICE candidate from host
		socket.on("ice-candidate", async ({sender, candidate}) => {
			console.log(`Received ICE candidate from ${sender}`, candidate);
			if (candidate) {
				try {
					await pc.addIceCandidate(new RTCIceCandidate(candidate));
				} catch (err) {
					console.error("Error adding ICE candidate", err);
				}
			}
		});

		// Send our ICE candidates to host
		pc.onicecandidate = (event) => {
			if (event.candidate) {
				socket.emit("ice-candidate", {
					roomId: roomCode,
					candidate: event.candidate,
				});
			}
		};
	};

	return (
		<div className="flex flex-col items-center justify-center h-screen gap-6 bg-gray-900 text-white p-4">
			<h1 className="text-3xl font-bold">Join a Stream</h1>

			{!joined ? (
				<>
					<input
						type="text"
						value={roomCode}
						onChange={(e) => setRoomCode(e.target.value)}
						placeholder="Enter room code"
						className="bg-gray-800 p-3 rounded text-lg w-72 text-center"
					/>
					<button onClick={joinRoom} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded text-lg">
						Join Stream
					</button>
				</>
			) : (
				<video ref={videoRef} className="w-full max-w-4xl rounded-lg shadow-lg" autoPlay controls />
			)}
		</div>
	);
}
