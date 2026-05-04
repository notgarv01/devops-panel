const setupSocket = (io) => {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join a deployment room for targeted logs
    socket.on('join-deployment', (deploymentId) => {
      socket.join(deploymentId);
      console.log(`Socket ${socket.id} joined deployment ${deploymentId}`);
    });

    // Leave deployment room
    socket.on('leave-deployment', (deploymentId) => {
      socket.leave(deploymentId);
      console.log(`Socket ${socket.id} left deployment ${deploymentId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};

module.exports = { setupSocket };