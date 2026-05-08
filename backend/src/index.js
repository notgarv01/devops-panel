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
const webhookRoutes = require('./routes/webhook.routes');
const projectRoutes = require('./routes/project.routes');
const authRoutes = require('./routes/auth.routes');
const notifyRoutes = require('./routes/notify.routes');
const janitorRoutes = require('./routes/janitor.routes');
const stackRoutes = require('./routes/stack.routes');
const auditRoutes = require('./routes/audit.routes');
const workspaceRoutes = require('./routes/workspace.routes');
const statusRoutes = require('./routes/status.routes');
const billingRoutes = require('./routes/billing.routes');
const Deploy = require('./models/Deploy');
const Project = require('./models/Project');
const Stack = require('./models/Stack');
const AuditLog = require('./models/AuditLog');
const User = require('./models/User');
const StatusPage = require('./models/StatusPage');
const Billing = require('./models/Billing');
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

// Middleware to capture raw body for webhook signature verification
app.use((req, res, next) => {
  let data = '';
  req.on('data', chunk => {
    data += chunk;
  });
  req.on('end', () => {
    req.rawBody = data;
    if (data && req.headers['content-type']?.includes('application/json')) {
      try {
        req.body = JSON.parse(data);
      } catch (e) {
        // Invalid JSON, leave body as-is
      }
    }
  });
  next();
});

// CORS and JSON middleware (applied after raw body capture)
app.use(cors());
app.use(express.json());

// Make io accessible to routes
app.set('io', io);

// Store io globally for worker access
global.io = io;

// Routes
app.use('/api/deploy', deployRoutes);
app.use('/api/intake', intakeRoutes);
app.use('/api/transform', transformRoutes);
app.use('/api/ship', shipRoutes);
app.use('/api/vercel', vercelRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/janitor', janitorRoutes);
app.use('/api/stacks', stackRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/billing', billingRoutes);

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