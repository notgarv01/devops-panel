const mongoose = require('mongoose');

// Workspace roles with permission levels
const ROLES = {
  viewer: 1,     // Read-only access
  developer: 2, // Can trigger deploys, view secrets
  admin: 3      // Full access including user management
};

const PERMISSIONS = {
  // Project operations
  'project:read': [ROLES.viewer, ROLES.developer, ROLES.admin],
  'project:create': [ROLES.developer, ROLES.admin],
  'project:update': [ROLES.developer, ROLES.admin],
  'project:delete': [ROLES.admin],
  'project:deploy': [ROLES.developer, ROLES.admin],
  'project:rollback': [ROLES.developer, ROLES.admin],

  // Environment variables
  'envvar:read': [ROLES.developer, ROLES.admin],
  'envvar:create': [ROLES.admin],
  'envvar:delete': [ROLES.admin],

  // Domain management
  'domain:add': [ROLES.admin],
  'domain:remove': [ROLES.admin],

  // Stack operations
  'stack:read': [ROLES.viewer, ROLES.developer, ROLES.admin],
  'stack:create': [ROLES.admin],
  'stack:manage': [ROLES.admin],

  // Team management
  'team:invite': [ROLES.admin],
  'team:remove': [ROLES.admin],
  'team:change_role': [ROLES.admin],

  // Settings
  'settings:read': [ROLES.admin],
  'settings:write': [ROLES.admin],

  // Audit logs
  'audit:read': [ROLES.admin]
};

const WorkspaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    unique: true
  },
  description: {
    type: String,
    maxLength: 500
  },
  // Workspace owner (can never be removed)
  owner: {
    type: String,
    required: true
  },
  // Team members
  members: [{
    userId: String,
    email: String,
    name: String,
    role: {
      type: String,
      enum: ['viewer', 'developer', 'admin'],
      default: 'viewer'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    invitedBy: String
  }],
  // Settings
  settings: {
    defaultRole: {
      type: String,
      enum: ['viewer', 'developer'],
      default: 'viewer'
    },
    enforceMFA: {
      type: Boolean,
      default: false
    },
    allowPublicDeployments: {
      type: Boolean,
      default: false
    }
  },
  // Limits
  limits: {
    maxProjects: {
      type: Number,
      default: 10
    },
    maxMembers: {
      type: Number,
      default: 5
    }
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

// Indexes
WorkspaceSchema.index({ slug: 1 });
WorkspaceSchema.index({ owner: 1 });
WorkspaceSchema.index({ 'members.userId': 1 });

// Pre-save hook to generate slug
WorkspaceSchema.pre('save', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  this.updatedAt = new Date();
  next();
});

// Check if user has permission
WorkspaceSchema.methods.hasPermission = function(userId, permission) {
  // Owner always has admin permissions
  if (this.owner === userId) {
    return true;
  }

  const member = this.members.find(m => m.userId === userId);
  if (!member) {
    return false;
  }

  const roleLevel = ROLES[member.role] || 0;
  const allowedRoles = PERMISSIONS[permission] || [];

  return allowedRoles.some(roleLevel => ROLES[roleLevel] <= roleLevel);
};

// Get user's role
WorkspaceSchema.methods.getUserRole = function(userId) {
  if (this.owner === userId) {
    return 'owner';
  }

  const member = this.members.find(m => m.userId === userId);
  return member?.role || null;
};

// Check if user is member
WorkspaceSchema.methods.isMember = function(userId) {
  if (this.owner === userId) {
    return true;
  }
  return this.members.some(m => m.userId === userId);
};

// Add member
WorkspaceSchema.methods.addMember = function(userData, role = 'viewer') {
  if (this.isMember(userData.userId)) {
    return { success: false, error: 'User already in workspace' };
  }

  if (this.members.length >= this.limits.maxMembers) {
    return { success: false, error: 'Member limit reached' };
  }

  this.members.push({
    userId: userData.userId,
    email: userData.email,
    name: userData.name,
    role,
    joinedAt: new Date(),
    invitedBy: userData.invitedBy
  });

  return { success: true };
};

// Remove member
WorkspaceSchema.methods.removeMember = function(userId) {
  const index = this.members.findIndex(m => m.userId === userId);
  if (index === -1) {
    return { success: false, error: 'User not in workspace' };
  }

  this.members.splice(index, 1);
  return { success: true };
};

// Update member role
WorkspaceSchema.methods.updateMemberRole = function(userId, newRole) {
  const member = this.members.find(m => m.userId === userId);
  if (!member) {
    return { success: false, error: 'User not in workspace' };
  }

  if (newRole === 'owner') {
    return { success: false, error: 'Cannot change owner role' };
  }

  member.role = newRole;
  return { success: true };
};

// Static method to find workspaces for a user
WorkspaceSchema.statics.findForUser = async function(userId) {
  return this.find({
    $or: [
      { owner: userId },
      { 'members.userId': userId }
    ]
  }).lean();
};

// Static method to get workspace by slug
WorkspaceSchema.statics.findBySlug = async function(slug) {
  return this.findOne({ slug }).lean();
};

module.exports = mongoose.model('Workspace', WorkspaceSchema);