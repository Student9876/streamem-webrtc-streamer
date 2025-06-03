// For development 
// import {BrowserRouter as Router, Routes, Route} from "react-router-dom";
// import Home from "./pages/Home";
// import Host from "./pages/Host";
// import Join from "./pages/Join";
// function App() {
// 	return (
// 		<Router>
// 			<Routes>
// 				<Route path="/" element={<Home />} />
// 				<Route path="/host" element={<Host />} />
// 				<Route path="/join" element={<Join />} />
// 			</Routes>
// 		</Router>
// 	);
// }

// export default App;


// For deployment 
// In App.tsx, ensure you're using HashRouter for static files
import {HashRouter as Router, Routes, Route} from "react-router-dom";
import Home from "./pages/Home";
import Host from "./pages/Host";
import Join from "./pages/Join";

function App() {
	return (
		<Router>
			<Routes>
				<Route path="/" element={<Home />} />
				<Route path="/host" element={<Host />} />
				<Route path="/join" element={<Join />} />
			</Routes>
		</Router>
	);
}
export default App;
