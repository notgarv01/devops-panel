const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { runTransformationPipeline } = require('../services/orchestrator');
const AuditLog = require('../models/AuditLog');

// Store webhook secrets by repo (in production, use a database)
const webhookSecrets = new Map();

// Generate a webhook secret for a repo
const getWebhookSecret = (owner, repo) => {
  const key = `${owner}/${repo}`;
  if (!webhookSecrets.has(key)) {
    webhookSecrets.set(key, crypto.randomBytes(32).toString('hex'));
  }
  return webhookSecrets.get(key);
};

// Verify GitHub webhook signature
const verifySignature = (payload, signature, secret) => {
  if (!signature || !secret) return false;

  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
};

// Handle GitHub webhook events
router.post('/github', async (req, res) => {
  const io = req.app.get('io');

  // Get signature from headers
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];

  // For GitHub, the payload comes as a buffer in rawBody
  const payload = req.rawBody || JSON.stringify(req.body);
  const payloadObj = typeof req.body === 'object' ? req.body : JSON.parse(payload);

  console.log(`[Webhook] Received ${event} event`);

  // Handle ping event
  if (event === 'ping') {
    console.log('[Webhook] Ping received, webhook is working!');
    return res.json({ ok: true, message: 'Webhook configured successfully' });
  }

  // Only handle push events
  if (event !== 'push') {
    console.log(`[Webhook] Ignoring ${event} event`);
    return res.status(200).send('Event ignored');
  }

  const { ref, repository, head_commit, commits } = payloadObj;

  console.log(`[Webhook] Push to ${ref}`);
  console.log(`[Webhook] Repository: ${repository.full_name}`);

  // Check if this is a push to main branch (the trigger)
  if (ref !== 'refs/heads/main') {
    console.log(`[Webhook] Ignoring push to ${ref} (not main)`);
    return res.status(200).send('Not a main branch push');
  }

  // Get webhook secret for this repo
  const secret = webhookSecrets.get(repository.full_name);

  // If we have a secret configured, verify the signature
  // In production, you'd want to fail if signature is missing/invalid
  // For now, we skip verification if we don't have the secret stored
  if (secret && signature) {
    if (!verifySignature(payload, signature, secret)) {
      console.log('[Webhook] Invalid signature!');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Check if this looks like a devops-deploy branch push (shouldn't trigger)
  if (ref.startsWith('refs/heads/devops-deploy')) {
    console.log('[Webhook] Ignoring push to devops-deploy branch (prevent infinite loop)');
    return res.status(200).send('Devops-deploy push ignored');
  }

  // This is a main branch push - trigger the transmutation pipeline!
  console.log(`[Webhook] Main branch updated! Triggering auto-transmutation...`);

  // Generate a session ID for this webhook-triggered run
  const sessionId = `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Extract repo info
  const repoUrl = repository.clone_url;
  const projectName = repository.name;

  // Log to any connected clients
  if (io) {
    io.emit('webhook-triggered', {
      sessionId,
      repo: repository.full_name,
      branch: ref,
      message: 'Auto-transmutation triggered by webhook'
    });
  }

  // Respond immediately - pipeline runs in background
  res.json({
    ok: true,
    message: 'Transmutation pipeline triggered',
    sessionId,
    repo: repository.full_name
  });

  // Log webhook trigger
  await AuditLog.log({
    action: 'webhook.triggered',
    resource: 'project',
    resourceId: repository.full_name,
    actor: {
      type: 'webhook',
      name: 'GitHub',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    },
    metadata: {
      repo: repository.full_name,
      branch: ref,
      commit: head_commit?.id?.substring(0, 7),
      commitMessage: head_commit?.message?.substring(0, 100)
    },
    project: { name: repository.name },
    severity: 'info'
  });

  // Run the pipeline in background
  console.log(`[Webhook:${sessionId}] Starting auto-transmutation for ${projectName}`);

  runTransformationPipeline(io, sessionId, {
    projectPath: repoUrl,
    projectName: projectName,
    githubToken: process.env.GITHUB_TOKEN, // Should be set in environment
    vercelToken: process.env.VERCEL_TOKEN, // Should be set in environment
    branch: 'main',
    envVars: [],
    options: {
      webhookUrl: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/webhooks/github`,
      isWebhookTriggered: true
    }
  }).then(result => {
    console.log(`[Webhook:${sessionId}] Auto-transmutation complete:`, result);
  }).catch(error => {
    console.error(`[Webhook:${sessionId}] Auto-transmutation failed:`, error.message);
  });
});

// Store secret for a repository (called by orchestrator after webhook creation)
router.post('/store-secret', (req, res) => {
  const { owner, repo, secret } = req.body;

  if (!owner || !repo || !secret) {
    return res.status(400).json({ error: 'owner, repo, and secret are required' });
  }

  const key = `${owner}/${repo}`;
  webhookSecrets.set(key, secret);

  console.log(`[Webhook] Stored secret for ${key}`);

  res.json({ ok: true });
});

// Get secret for a repository
router.get('/get-secret/:owner/:repo', (req, res) => {
  const { owner, repo } = req.params;
  const key = `${owner}/${repo}`;

  const secret = webhookSecrets.get(key);

  if (!secret) {
    return res.status(404).json({ error: 'No secret found for this repository' });
  }

  res.json({ secret });
});

module.exports = router;