const mongoose = require('mongoose');

// Pricing tiers
const TIERS = {
  free: {
    name: 'Free',
    price: 0,
    limits: {
      projects: 2,
      teamMembers: 1,
      buildsPerMonth: 100,
      deployTargets: ['vercel']
    }
  },
  starter: {
    name: 'Starter',
    price: 29,
    limits: {
      projects: 10,
      teamMembers: 3,
      buildsPerMonth: 1000,
      deployTargets: ['vercel', 'netlify']
    }
  },
  pro: {
    name: 'Pro',
    price: 99,
    limits: {
      projects: -1, // unlimited
      teamMembers: 10,
      buildsPerMonth: -1,
      deployTargets: ['vercel', 'netlify', 'railway', 'amplify']
    }
  },
  enterprise: {
    name: 'Enterprise',
    price: 299,
    limits: {
      projects: -1,
      teamMembers: -1,
      buildsPerMonth: -1,
      deployTargets: ['vercel', 'netlify', 'railway', 'amplify', 'custom'],
      features: ['sso', 'audit_logs', 'priority_support', 'custom_domains']
    }
  }
};

const BillingSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true
  },
  // Stripe customer ID
  stripeCustomerId: String,
  // Subscription
  subscription: {
    tier: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete'],
      default: 'active'
    },
    stripeSubscriptionId: String,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: Boolean
  },
  // Usage tracking
  usage: {
    projects: { type: Number, default: 0 },
    teamMembers: { type: Number, default: 0 },
    buildsThisMonth: { type: Number, default: 0 },
    lastBuildCountReset: { type: Date, default: Date.now }
  },
  // Build minutes tracking (if applicable)
  buildMinutes: {
    used: { type: Number, default: 0 },
    included: { type: Number, default: 500 },
    limit: { type: Number, default: 500 }
  },
  // Payment info
  paymentMethod: {
    type: String,
    last4: String,
    brand: String,
    expiryMonth: Number,
    expiryYear: Number
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

// Get tier info
BillingSchema.methods.getTier = function() {
  return TIERS[this.subscription.tier] || TIERS.free;
};

// Check if feature is available
BillingSchema.methods.hasFeature = function(feature) {
  const tier = this.getTier();
  return tier.features?.includes(feature) || false;
};

// Check if target is available
BillingSchema.methods.canDeployTo = function(target) {
  const tier = this.getTier();
  return tier.limits.deployTargets.includes(target);
};

// Check project limit
BillingSchema.methods.canAddProject = function() {
  const tier = this.getTier();
  const limit = tier.limits.projects;

  if (limit === -1) return true; // unlimited
  return this.usage.projects < limit;
};

// Check team limit
BillingSchema.methods.canAddMember = function() {
  const tier = this.getTier();
  const limit = tier.limits.teamMembers;

  if (limit === -1) return true;
  return this.usage.teamMembers < limit;
};

// Check build limit
BillingSchema.methods.canBuild = function() {
  const tier = this.getTier();
  const limit = tier.limits.buildsPerMonth;

  if (limit === -1) return true;
  return this.usage.buildsThisMonth < limit;
};

// Increment build count
BillingSchema.methods.recordBuild = async function() {
  this.usage.buildsThisMonth += 1;
  this.buildMinutes.used += 1; // Simplified
  await this.save();
};

// Reset monthly usage
BillingSchema.methods.resetMonthlyUsage = async function() {
  this.usage.buildsThisMonth = 0;
  this.usage.lastBuildCountReset = new Date();
  this.buildMinutes.used = 0;
  await this.save();
};

// Check if trial is available
BillingSchema.methods.isOnTrial = function() {
  return this.subscription.status === 'trialing';
};

// Get usage summary
BillingSchema.methods.getUsageSummary = function() {
  const tier = this.getTier();

  return {
    projects: {
      used: this.usage.projects,
      limit: tier.limits.projects,
      unlimited: tier.limits.projects === -1
    },
    teamMembers: {
      used: this.usage.teamMembers,
      limit: tier.limits.teamMembers,
      unlimited: tier.limits.teamMembers === -1
    },
    builds: {
      used: this.usage.buildsThisMonth,
      limit: tier.limits.buildsPerMonth,
      unlimited: tier.limits.buildsPerMonth === -1
    },
    buildMinutes: {
      used: this.buildMinutes.used,
      included: this.buildMinutes.included
    }
  };
};

// Static method to check limit
BillingSchema.statics.checkLimit = async function(workspaceId, resourceType) {
  const billing = await this.findOne({ workspaceId });

  if (!billing) return { allowed: true }; // Free tier

  switch (resourceType) {
    case 'project':
      return { allowed: billing.canAddProject() };
    case 'member':
      return { allowed: billing.canAddMember() };
    case 'build':
      return { allowed: billing.canBuild() };
    default:
      return { allowed: true };
  }
};

// Static method to get billing for workspace
BillingSchema.statics.getForWorkspace = async function(workspaceId) {
  let billing = await this.findOne({ workspaceId });

  if (!billing) {
    billing = new this({
      workspaceId,
      subscription: { tier: 'free' }
    });
    await billing.save();
  }

  return billing;
};

module.exports = mongoose.model('Billing', BillingSchema);