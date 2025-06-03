import {useEffect} from "react";
import {useNavigate} from "react-router-dom";

export default function Home() {
	const navigate = useNavigate();

	useEffect(() => {
		console.log("Window electronAPI:", window.electronAPI);
		if (!window.electronAPI) {
			console.error("electronAPI not available!");
		}
	}, []);

	return (
		<div className="flex flex-col items-center justify-center h-screen gap-6 bg-gray-900 text-white">
			<h1 className="text-4xl font-bold">Welcome to StreamEM</h1>
			<p className="text-lg text-gray-300">Share your screen with friends in real-time with high resolution and fps</p>

			<div className="flex gap-4 mt-6">
				<button onClick={() => navigate("/host")} className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg text-lg">
					Start a Stream
				</button>
				<button onClick={() => navigate("/join")} className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg text-lg">
					Join a Stream
				</button>
			</div>
		</div>
	);
}
