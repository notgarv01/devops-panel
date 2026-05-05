const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const deployRoutes = require('./routes/deploy.routes');
const intakeRoutes = require('./routes/intake.routes');
const transformRoutes = require('./routes/transform.routes');
const shipRoutes = require('./routes/ship.routes');
const vercelRoutes = require('./routes/vercel.routes');
const pipelineRoutes = require('./routes/pipeline.routes');
const Deploy = require('./models/Deploy');
const { setupSocket } = require('./socket/socketHandler');
const { cleanupDeadContainers } = require('./utils/dockerOperations');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Make io accessible to routes
app.set('io', io);

// Routes
app.use('/api/deploy', deployRoutes);
app.use('/api/intake', intakeRoutes);
app.use('/api/transform', transformRoutes);
app.use('/api/ship', shipRoutes);
app.use('/api/vercel', vercelRoutes);
app.use('/api/pipeline', pipelineRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/devops-panel')
  .then(() => {
    console.log('Connected to MongoDB');
    // Cleanup orphaned containers on startup
    cleanupDeadContainers();
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Setup socket handlers
setupSocket(io);

// Periodic cleanup every 30 minutes
setInterval(cleanupDeadContainers, 30 * 60 * 1000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };