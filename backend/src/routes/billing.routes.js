const express = require('express');
const router = express.Router();
const Billing = require('../models/Billing');
const AuditLog = require('../models/AuditLog');

// Initialize Stripe only if module is available
let Stripe = null;
let stripe = null;
try {
  Stripe = require('stripe');
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    console.log('[Billing] Stripe initialized');
  }
} catch (e) {
  console.log('[Billing] Stripe module not available - billing features disabled');
}

// Get billing info for workspace
router.get('/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const billing = await Billing.getForWorkspace(workspaceId);
    const usage = billing.getUsageSummary();
    const tier = billing.getTier();

    res.json({
      tier: billing.subscription.tier,
      tierName: tier.name,
      status: billing.subscription.status,
      usage,
      limits: tier.limits,
      paymentMethod: billing.paymentMethod,
      stripeConfigured: !!stripe,
      subscription: {
        currentPeriodStart: billing.subscription.currentPeriodStart,
        currentPeriodEnd: billing.subscription.currentPeriodEnd,
        cancelAtPeriodEnd: billing.subscription.cancelAtPeriodEnd
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get usage summary
router.get('/:workspaceId/usage', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const billing = await Billing.getForWorkspace(workspaceId);
    res.json(billing.getUsageSummary());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check if action is allowed
router.get('/:workspaceId/check/:action', async (req, res) => {
  const { workspaceId, action } = req.params;

  try {
    const billing = await Billing.getForWorkspace(workspaceId);

    let allowed = true;
    let reason = null;

    switch (action) {
      case 'project':
        if (!billing.canAddProject()) {
          allowed = false;
          reason = `Project limit reached (${billing.getTier().limits.projects} max)`;
        }
        break;
      case 'member':
        if (!billing.canAddMember()) {
          allowed = false;
          reason = `Team member limit reached (${billing.getTier().limits.teamMembers} max)`;
        }
        break;
      case 'build':
        if (!billing.canBuild()) {
          allowed = false;
          reason = `Monthly build limit reached (${billing.getTier().limits.buildsPerMonth} max)`;
        }
        break;
      case 'deploy-netlify':
        if (!billing.canDeployTo('netlify')) {
          allowed = false;
          reason = 'Netlify deployment requires Pro tier or higher';
        }
        break;
      default:
        allowed = true;
    }

    res.json({ allowed, reason });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or get Stripe customer
router.post('/:workspaceId/stripe/customer', async (req, res) => {
  const { workspaceId } = req.params;
  const { email, name } = req.body;

  if (!stripe) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  try {
    const billing = await Billing.getForWorkspace(workspaceId);

    if (billing.stripeCustomerId) {
      return res.json({ customerId: billing.stripeCustomerId });
    }

    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { workspaceId }
    });

    billing.stripeCustomerId = customer.id;
    await billing.save();

    res.json({ customerId: customer.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create checkout session for subscription upgrade
router.post('/:workspaceId/checkout', async (req, res) => {
  const { workspaceId } = req.params;
  const { tier, successUrl, cancelUrl } = req.body;

  if (!stripe) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  const tierPrices = {
    starter: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter',
    pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro',
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise'
  };

  try {
    const billing = await Billing.getForWorkspace(workspaceId);

    const session = await stripe.checkout.sessions.create({
      customer: billing.stripeCustomerId,
      mode: 'subscription',
      line_items: [{
        price: tierPrices[tier],
        quantity: 1
      }],
      success_url: successUrl || `${process.env.FRONTEND_URL}/billing?success=true`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/billing?canceled=true`,
      metadata: { workspaceId, tier }
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create customer portal session
router.post('/:workspaceId/portal', async (req, res) => {
  const { workspaceId } = req.params;
  const { returnUrl } = req.body;

  if (!stripe) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  try {
    const billing = await Billing.getForWorkspace(workspaceId);

    if (!billing.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      return_url: returnUrl || process.env.FRONTEND_URL
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Handle Stripe webhook - requires raw body parser
// Use standard JSON parsing since Stripe isn't available anyway
router.post('/webhook', async (req, res) => {
  if (!stripe) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  const rawBody = req.rawBody;

  if (!rawBody) {
    return res.status(400).json({ error: 'Raw body required for webhook' });
  }

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[Billing] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const workspaceId = subscription.metadata?.workspaceId;

      if (workspaceId) {
        const billing = await Billing.findOne({ workspaceId });
        if (billing) {
          billing.subscription.stripeSubscriptionId = subscription.id;
          billing.subscription.tier = subscription.metadata?.tier || 'starter';
          billing.subscription.status = subscription.status;
          billing.subscription.currentPeriodStart = new Date(subscription.current_period_start * 1000);
          billing.subscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
          billing.subscription.cancelAtPeriodEnd = subscription.cancel_at_period_end;
          await billing.save();

          await AuditLog.log({
            action: 'billing.subscription_changed',
            resource: 'billing',
            resourceId: billing._id.toString(),
            actor: { type: 'system' },
            metadata: { tier: billing.subscription.tier, status: billing.subscription.status },
            severity: 'info'
          });
        }
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const workspaceId = subscription.metadata?.workspaceId;

      if (workspaceId) {
        const billing = await Billing.findOne({ workspaceId });
        if (billing) {
          billing.subscription.status = 'canceled';
          billing.subscription.tier = 'free';
          await billing.save();

          await AuditLog.log({
            action: 'billing.subscription_canceled',
            resource: 'billing',
            resourceId: billing._id.toString(),
            actor: { type: 'system' },
            metadata: { workspaceId },
            severity: 'warning'
          });
        }
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const billing = await Billing.findOne({ stripeCustomerId: invoice.customer });
      if (billing) {
        billing.subscription.status = 'past_due';
        await billing.save();

        await AuditLog.log({
          action: 'billing.payment_failed',
          resource: 'billing',
          resourceId: billing._id.toString(),
          actor: { type: 'system' },
          metadata: { invoiceId: invoice.id },
          severity: 'critical'
        });
      }
      break;
    }
  }

  res.json({ received: true });
});

// Update usage after build
router.post('/:workspaceId/usage/build', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const billing = await Billing.getForWorkspace(workspaceId);
    await billing.recordBuild();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upgrade tier (admin override)
router.post('/:workspaceId/upgrade', async (req, res) => {
  const { tier, adminKey } = req.body;

  if (adminKey !== process.env.ADMIN_UPGRADE_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  try {
    const billing = await Billing.getForWorkspace(workspaceId);
    billing.subscription.tier = tier;
    billing.subscription.status = 'active';
    await billing.save();

    await AuditLog.log({
      action: 'billing.tier_upgraded',
      resource: 'billing',
      resourceId: billing._id.toString(),
      actor: { type: 'system', name: 'Admin' },
      metadata: { newTier: tier },
      severity: 'info'
    });

    res.json({ success: true, tier });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;