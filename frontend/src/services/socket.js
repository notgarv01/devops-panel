import { io } from 'socket.io-client';

// Use relative URL to work through Vite proxy
const WS_URL = import.meta.env.VITE_WS_URL || '';

export const socket = io(WS_URL || window.location.origin, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  path: '/socket.io',
});

export const connectToDeployment = (deploymentId) => {
  socket.connect();
  socket.emit('join-deployment', deploymentId);
};

export const disconnectFromDeployment = (deploymentId) => {
  socket.emit('leave-deployment', deploymentId);
  socket.disconnect();
};

export default socket;