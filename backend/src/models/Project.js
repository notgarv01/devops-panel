const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  owner: {
    type: String,
    required: true
  },
  repoUrl: {
    type: String,
    required: true
  },
  // Stack grouping (for multi-repo apps)
  stackId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stack',
    default: null
  },
  stackRole: {
    type: String,
    enum: ['frontend', 'backend', 'shared', 'standalone'],
    default: 'standalone'
  },
  // Branch info
  targetBranch: {
    type: String,
    default: 'devops-deploy'
  },
  mainBranch: {
    type: String,
    default: 'main'
  },
  // Deployment status
  status: {
    type: String,
    enum: ['live', 'building', 'failed', 'stopped', 'pending', 'queued'],
    default: 'pending'
  },
  // Vercel info
  vercelProjectId: {
    type: String
  },
  vercelUrl: {
    type: String
  },
  // Netlify info (for multi-cloud)
  netlifySiteId: {
    type: String
  },
  netlifyUrl: {
    type: String
  },
  // GitHub info
  githubUrl: {
    type: String
  },
  // Environment
  environment: {
    type: String,
    enum: ['production', 'preview', 'development'],
    default: 'production'
  },
  // Framework detection
  framework: {
    type: String,
    enum: ['vite', 'next', 'react', 'node', 'static', 'unknown'],
    default: 'unknown'
  },
  // AI diagnosis (from build failures)
  aiDiagnosis: {
    type: String
  },
  // Deployment targets
  deploymentTargets: [{
    platform: {
      type: String,
      enum: ['vercel', 'netlify', 'railway', 'amplify']
    },
    enabled: {
      type: Boolean,
      default: false
    },
    siteId: String,
    url: String,
    status: String
  }],
  // Timestamps
  lastWebhookAt: {
    type: Date
  },
  lastDeployAt: {
    type: Date
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

// Index for faster queries (name:1 removed - unique:true on field already creates index)
// Note: unique:true in field definition automatically creates a unique index
ProjectSchema.index({ owner: 1 });
ProjectSchema.index({ status: 1 });
ProjectSchema.index({ stackId: 1 });
ProjectSchema.index({ lastWebhookAt: -1 });

// Update timestamp on save
ProjectSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Project', ProjectSchema);