import { io } from 'socket.io-client';

// Use backend API URL for socket connection
const API_URL = import.meta.env.VITE_API_URL || '';
const WS_URL = API_URL.replace('/api', '') || window.location.origin;

export const socket = io(WS_URL, {
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