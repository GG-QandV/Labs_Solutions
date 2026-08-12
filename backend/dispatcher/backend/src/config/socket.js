import { Server } from 'socket.io';
import { createRedisClient } from '../config/redis.js';

let io;

export const initSocket = async (server) => {
  io = new Server(server, {
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:5174', process.env.FRONTEND_URL].filter(Boolean),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  const subscriber = createRedisClient();

  subscriber.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      if (channel === 'request:classified') io.emit('request:classified', data);
      if (channel === 'request:failed') io.emit('request:failed', data);
      if (channel === 'request:event') io.emit('request:event', data);
    } catch (err) {
      console.error('Failed to parse Redis message:', err);
    }
  });

  await subscriber.subscribe('request:classified', 'request:failed', 'request:event');

  console.log('Socket.io initialized');
  return io;
};

export const getIO = () => {
  if (!io) throw new Error('Socket not initialized');
  return io;
};