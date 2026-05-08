const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      // Deployments
      'deployment.started',
      'deployment.completed',
      'deployment.failed',
      'deployment.rollback',
      'deployment.canceled',
      // Webhooks
      'webhook.triggered',
      'webhook.received',
      // Secrets & Security
      'secret.detected',
      'secret.exposed',
      'secret.removed',
      // Projects
      'project.created',
      'project.updated',
      'project.deleted',
      'project.archived',
      // Configuration
      'envvar.added',
      'envvar.updated',
      'envvar.removed',
      'domain.added',
      'domain.removed',
      'edgeconfig.updated',
      // Team & Access
      'team.invited',
      'team.role_changed',
      'team.removed',
      // Stack operations
      'stack.created',
      'stack.updated',
      'stack.project_added',
      'stack.project_removed',
      // AI & Diagnostics
      'ai.diagnosis_generated',
      // Admin actions
      'admin.settings_changed',
      'admin.export_data'
    ]
  },
  resource: {
    type: String,
    required: true
  },
  resourceId: {
    type: String
  },
  // Who performed the action
  actor: {
    id: String,
    type: {
      type: String,
      enum: ['user', 'system', 'webhook', 'api'],
      default: 'user'
    },
    name: String,
    ip: String,
    userAgent: String
  },
  // What changed
  changes: [{
    field: String,
    from: mongoose.Schema.Types.Mixed,
    to: mongoose.Schema.Types.Mixed
  }],
  // Context and metadata
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  // Severity
  severity: {
    type: String,
    enum: ['debug', 'info', 'warning', 'critical'],
    default: 'info'
  },
  // Project context
  project: {
    name: String,
    id: mongoose.Schema.Types.ObjectId
  },
  // Stack context
  stack: {
    name: String,
    id: mongoose.Schema.Types.ObjectId
  },
  // Timestamps
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for efficient queries
AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ resource: 1, timestamp: -1 });
AuditLogSchema.index({ 'actor.id': 1, timestamp: -1 });
AuditLogSchema.index({ 'project.name': 1, timestamp: -1 });
AuditLogSchema.index({ severity: 1, timestamp: -1 });
AuditLogSchema.index({ timestamp: -1 });

// Static method to log an action
AuditLogSchema.statics.log = async function(data) {
  try {
    const entry = new this({
      ...data,
      timestamp: new Date()
    });
    await entry.save();
    return entry;
  } catch (error) {
    console.error('[AuditLog] Failed to write log:', error.message);
    // Don't throw - audit logging should never break the main flow
    return null;
  }
};

// Static method for quick security events
AuditLogSchema.statics.logSecurityEvent = async function(action, resource, actor, details = {}) {
  return this.log({
    action,
    resource,
    actor: {
      id: actor?.id || actor,
      type: actor?.type || 'system',
      name: actor?.name || 'System',
      ip: details.ip,
      userAgent: details.userAgent
    },
    severity: action.includes('secret') || action.includes('critical') ? 'warning' : 'info',
    metadata: details.metadata
  });
};

// Static method to get audit trail for a resource
AuditLogSchema.statics.getResourceHistory = async function(resource, limit = 50) {
  return this.find({ resource })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

// Static method to get user activity
AuditLogSchema.statics.getUserActivity = async function(userId, limit = 50) {
  return this.find({ 'actor.id': userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

// Static method to get recent system events
AuditLogSchema.statics.getRecentEvents = async function(limit = 100) {
  return this.find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

// Static method to export audit logs (for compliance)
AuditLogSchema.statics.exportLogs = async function(startDate, endDate) {
  return this.find({
    timestamp: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ timestamp: -1 }).lean();
};

// Pre-save middleware to ensure data integrity
AuditLogSchema.pre('save', function(next) {
  // Ensure timestamp is set
  if (!this.timestamp) {
    this.timestamp = new Date();
  }
  next();
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);