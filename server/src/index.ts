// server/index.ts
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors()); // Enable CORS for all routes

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
});

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join-room", (roomId) => {
        socket.join(roomId);
        console.log(`${socket.id} joined room ${roomId}`);
        socket.to(roomId).emit("user-joined", socket.id);
    });

    socket.on("offer", ({ roomId, offer }) => {
        socket.to(roomId).emit("offer", { sender: socket.id, offer });
    });

    socket.on("answer", ({ roomId, answer }) => {
        socket.to(roomId).emit("answer", { sender: socket.id, answer });
    });

    socket.on("ice-candidate", ({ roomId, candidate }) => {
        socket.to(roomId).emit("ice-candidate", {
            sender: socket.id,
            candidate,
        });
    });

    socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

app.get('/health', (req, res) => {
  res.status(200).send('Server is running');
});

// At the end of the file, make sure it listens on all interfaces
const PORT = process.env.PORT || 3001;
server.listen({ port: PORT, host: "0.0.0.0" }, () => {
    console.log(`Signaling server running on http://localhost:${PORT}`);
});
