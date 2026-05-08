const mongoose = require('mongoose');

const StackSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  owner: {
    type: String,
    required: true
  },
  // Projects in this stack
  projects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  }],
  // Stack-level settings
  autoSync: {
    type: Boolean,
    default: true
  },
  // When one repo in stack is updated, trigger redeploys of others
  cascadeDeploy: {
    type: Boolean,
    default: true
  },
  // Deployment order (frontend first, then backend)
  deploymentOrder: {
    type: String,
    enum: ['frontend-first', 'backend-first', 'parallel'],
    default: 'frontend-first'
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

// Index for faster queries
StackSchema.index({ owner: 1 });
StackSchema.index({ name: 1 });

// Update timestamp on save
StackSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for project count
StackSchema.virtual('projectCount').get(function() {
  return this.projects?.length || 0;
});

module.exports = mongoose.model('Stack', StackSchema);