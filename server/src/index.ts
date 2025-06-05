import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import net from 'net';

const app = express();
const DEFAULT_PORT = 3001;

// Function to find an available port
async function findAvailablePort(startPort: number): Promise<number> {
  const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  };

  let port = startPort;
  while (!(await isPortAvailable(port))) {
    console.log(`Port ${port} is already in use, trying next port...`);
    port++;
    // Prevent infinite loops by setting a maximum
    if (port > startPort + 100) {
      throw new Error('No available ports found');
    }
  }
  return port;
}

async function startServer() {
  try {
    // Find an available port
    const PORT = await findAvailablePort(DEFAULT_PORT);
    
    // Set up middleware
    app.use(cors({
      origin: '*', 
      methods: ['GET', 'POST']
    }));
    
    app.use(express.json());
    
    // Add status endpoint that returns the port
    app.get('/api/status', (req, res) => {
      res.json({ status: 'OK', message: 'Server is running', port: PORT });
    });
    
    const server = http.createServer(app);
    const io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    // Socket.io event handlers
    io.on('connection', (socket) => {
      console.log('👤 User connected:', socket.id);
      
      socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`👤 User ${socket.id} joined room ${roomId}`);
        socket.to(roomId).emit('user-joined', socket.id);
      });
      
      socket.on('offer', ({ roomId, offer }) => {
        socket.to(roomId).emit('offer', { sender: socket.id, offer });
      });
      
      socket.on('answer', ({ roomId, answer }) => {
        socket.to(roomId).emit('answer', { sender: socket.id, answer });
      });
      
      socket.on('ice-candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('ice-candidate', { sender: socket.id, candidate });
      });
      
      socket.on('disconnect', () => {
        console.log('👤 User disconnected:', socket.id);
      });
    });
    
    // Start the server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      
      // If running in Electron, notify the main process about the port
      if (process.send) {
        process.send({ type: 'server-started', port: PORT });
      }
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    if (process.send) {
      const errorMessage = (err instanceof Error) ? err.message : String(err);
      process.send({ type: 'server-error', error: errorMessage });
    }
  }
}

startServer();
