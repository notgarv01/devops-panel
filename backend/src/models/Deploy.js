const mongoose = require('mongoose');

const deploySchema = new mongoose.Schema({
  projectName: {
    type: String,
    required: true,
    trim: true
  },
  repoUrl: {
    type: String,
    required: true
  },
  branch: {
    type: String,
    default: 'main'
  },
  projectType: {
    type: String,
    enum: ['single', 'mern'],
    default: 'single'
  },
  containerId: {
    type: String,
    default: null
  },
  containerPort: {
    type: Number,
    default: null
  },
  hostPort: {
    type: Number,
    default: null
  },
  containers: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  networkName: {
    type: String,
    default: null
  },
  composeFile: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'cloning', 'building', 'running', 'stopped', 'error', 'deleted'],
    default: 'pending'
  },
  logs: [{
    timestamp: { type: Date, default: Date.now },
    level: { type: String, enum: ['info', 'success', 'error', 'warning'] },
    message: String
  }],
  envVars: [{
    key: String,
    value: String
  }],
  commitHash: {
    type: String,
    default: null
  },
  deployedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

deploySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Index for faster queries
deploySchema.index({ status: 1 });
deploySchema.index({ projectName: 1 });

module.exports = mongoose.model('Deploy', deploySchema);