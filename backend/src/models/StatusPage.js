const mongoose = require('mongoose');

const StatusPageSchema = new mongoose.Schema({
  // Public URL slug (e.g., "gupta-sales" for status.example.com/gupta-sales)
  slug: {
    type: String,
    required: true,
    unique: true
  },
  // Display name
  name: {
    type: String,
    required: true
  },
  // Stack or project this status page represents
  stackId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stack'
  },
  // Projects to show status for
  projects: [{
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project'
    },
    name: String,
    showUrl: Boolean
  }],
  // Custom branding
  branding: {
    logo: String,
    primaryColor: { type: String, default: '#10B981' },
    accentColor: { type: String, default: '#06B6D4' }
  },
  // Published status
  published: {
    type: Boolean,
    default: false
  },
  // Incident management
  incidents: [{
    id: String,
    title: String,
    status: {
      type: String,
      enum: ['investigating', 'identified', 'monitoring', 'resolved'],
      default: 'investigating'
    },
    impact: {
      type: String,
      enum: ['none', 'minor', 'major', 'critical'],
      default: 'minor'
    },
    startedAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    updates: [{
      message: String,
      timestamp: { type: Date, default: Date.now }
    }]
  }],
  // Uptime history (calculated daily)
  uptimeHistory: [{
    date: Date,
    uptimePercent: Number,
    avgResponseTime: Number
  }],
  // Public API key for embedding
  publicApiKey: {
    type: String,
    default: () => require('crypto').randomBytes(16).toString('hex')
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

// Index for fast lookups (slug:1 removed - unique:true on field already creates index)
StatusPageSchema.index({ published: 1 });

// Calculate uptime percentage
StatusPageSchema.methods.calculateUptime = function(days = 30) {
  const history = this.uptimeHistory
    .filter(h => h.date >= new Date(Date.now() - days * 24 * 60 * 60 * 1000))
    .map(h => h.uptimePercent);

  if (history.length === 0) return 100;
  return Math.round(history.reduce((a, b) => a + b, 0) / history.length * 100) / 100;
};

// Get current status summary
StatusPageSchema.methods.getStatusSummary = async function() {
  const Project = mongoose.model('Project');

  const projectStatuses = await Promise.all(
    this.projects.map(async (p) => {
      const project = await Project.findById(p.projectId);
      return {
        name: p.name,
        status: project?.status || 'unknown',
        url: p.showUrl ? project?.vercelUrl : null
      };
    })
  );

  // Determine overall status
  const hasIssue = projectStatuses.some(p => p.status === 'failed');
  const hasBuilding = projectStatuses.some(p => p.status === 'building');

  let overallStatus = 'operational';
  if (hasIssue) overallStatus = 'degraded';
  if (hasBuilding) overallStatus = 'investigating';

  return {
    overallStatus,
    projects: projectStatuses,
    uptime: this.calculateUptime(),
    activeIncidents: this.incidents.filter(i => !i.resolvedAt)
  };
};

// Static method to generate public status page
StatusPageSchema.statics.getPublicPage = async function(slug) {
  const page = await this.findOne({ slug, published: true })
    .populate('projects.projectId');

  if (!page) return null;

  const summary = await page.getStatusSummary();

  return {
    name: page.name,
    slug: page.slug,
    ...summary,
    branding: page.branding,
    incidents: summary.activeIncidents,
    lastUpdated: page.updatedAt
  };
};

// Generate status page slug
StatusPageSchema.statics.generateSlug = function(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

module.exports = mongoose.model('StatusPage', StatusPageSchema);