const express = require('express');
const router = express.Router();
const { createVercelService } = require('../services/vercel.service');

const log = (io, sessionId, level, message) => {
  const entry = {
    sessionId,
    timestamp: new Date(),
    level,
    message
  };
  if (io) io.to(sessionId).emit('vercel-log', entry);
  console.log(`[Vercel:${sessionId}] [${level}] ${message}`);
};

const FRAMEWORK_MAP = {
  'react': { framework: 'react' },
  'next': { framework: 'nextjs' },
  'nuxt': { framework: 'nextjs' },
  'vue': { framework: 'vue' },
  'static': { framework: null },
  'node': { framework: null },
  'express': { framework: null }
};

router.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const vercel = createVercelService(token);
    const user = await vercel.getUser();

    res.json({
      valid: true,
      user: {
        name: user.name,
        email: user.email,
        username: user.username,
        avatar: user.avatar
      }
    });

  } catch (error) {
    res.status(401).json({
      valid: false,
      error: 'Invalid or expired Vercel token'
    });
  }
});

router.post('/deploy', async (req, res) => {
  const io = req.app.get('io');
  const {
    vercelToken,
    githubToken,
    repoOwner,
    repoName,
    branch = 'main',
    projectName,
    projectType,
    envVars = [],
    teamId = null,
    options = {}
  } = req.body;

  // Validation
  if (!vercelToken) {
    return res.status(400).json({ error: 'Vercel token is required' });
  }

  if (!repoOwner || !repoName) {
    return res.status(400).json({ error: 'GitHub repo details required (owner, name)' });
  }

  const sessionId = `vercel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  res.status(202).json({
    success: true,
    message: 'Vercel deployment pipeline started',
    sessionId
  });

  await startVercelPipeline(sessionId, {
    vercelToken,
    githubToken,
    repoOwner,
    repoName,
    branch,
    projectName: projectName || repoName,
    projectType,
    envVars,
    teamId,
    options,
    io
  });
});

const startVercelPipeline = async (sessionId, config) => {
  const {
    vercelToken,
    githubToken,
    repoOwner,
    repoName,
    branch,
    projectName,
    projectType,
    envVars,
    teamId,
    options,
    io
  } = config;

  const vercel = createVercelService(vercelToken);

  try {
    // ===== STEP 1: Verify/Create Project =====
    log(io, sessionId, 'info', 'Checking for existing Vercel project...');

    let project = await vercel.getProject(projectName);

    if (!project) {
      log(io, sessionId, 'info', `Creating new project: ${projectName}`);

      const framework = projectType ? FRAMEWORK_MAP[projectType.toLowerCase()]?.framework : null;

      project = await vercel.createProject({
        name: projectName,
        teamId,
        gitSource: {
          type: 'github',
          repo: `${repoOwner}/${repoName}`,
          ref: branch,
          deploymentBranch: branch
        },
        framework
      });

      log(io, sessionId, 'success', `Project created: vercel.com/${projectName}`);
    } else {
      log(io, sessionId, 'info', `Using existing project: ${project.name}`);
    }

    // ===== STEP 2: Inject Environment Variables =====
    if (envVars.length > 0) {
      log(io, sessionId, 'info', `Setting ${envVars.length} environment variable(s)...`);

      const existingVars = await vercel.getEnvVars(project.id).catch(() => ({ envs: [] }));
      const existingKeys = new Set(existingVars.envs?.map(e => e.key) || []);

      const results = { added: 0, skipped: 0, errors: 0 };

      for (const envVar of envVars) {
        try {
          // Check if already exists
          if (existingKeys.has(envVar.key)) {
            log(io, sessionId, 'info', `  Skipping ${envVar.key} (already exists)`);
            results.skipped++;
            continue;
          }

          await vercel.addEnvVar(project.id, {
            key: envVar.key,
            value: envVar.value,
            target: envVar.target || 'production',
            type: envVar.type || 'secret'
          });

          log(io, sessionId, 'info', `  + ${envVar.key}`);
          results.added++;
        } catch (error) {
          log(io, sessionId, 'warning', `  Failed to set ${envVar.key}: ${error.message}`);
          results.errors++;
        }
      }

      log(io, sessionId, 'info', `Env vars: ${results.added} added, ${results.skipped} skipped, ${results.errors} errors`);
    }

    // ===== STEP 3: Trigger Deployment =====
    log(io, sessionId, 'info', 'Triggering deployment...');

    const deployment = await vercel.createDeployment({
      name: projectName,
      gitSource: {
        type: 'github',
        repo: `${repoOwner}/${repoName}`,
        ref: branch
      },
      forceNew: true,
      withCache: true,
      teamId
    });

    log(io, sessionId, 'info', `Deployment queued: ${deployment.id}`);

    // ===== STEP 4: Wait for completion =====
    await pollDeploymentStatus(sessionId, vercel, deployment.id, io);

    log(io, sessionId, 'success', '===== Vercel Deployment Complete =====');

  } catch (error) {
    log(io, sessionId, 'error', `Pipeline failed: ${error.message}`);
    console.error(`[Vercel:${sessionId}] Error:`, error);
  }
};

const pollDeploymentStatus = async (sessionId, vercel, deploymentId, io, maxAttempts = 30) => {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const deployment = await vercel.getDeployment(deploymentId);
      const { state, readyState } = deployment;

      log(io, sessionId, 'info', `Status: ${readyState || state}`);

      if (readyState === 'READY') {
        log(io, sessionId, 'success', `Live at: ${deployment.url}`);
        return deployment;
      }

      if (readyState === 'ERROR' || readyState === 'CANCELED') {
        log(io, sessionId, 'error', `Deployment ${readyState.toLowerCase()}`);
        return deployment;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

    } catch (error) {
      log(io, sessionId, 'warning', `Poll error: ${error.message}`);
      attempts++;
    }
  }

  log(io, sessionId, 'warning', 'Polling timed out, deployment may still be in progress');
  return null;
};

router.post('/redeploy', async (req, res) => {
  const { vercelToken, projectId, deploymentId, teamId } = req.body;

  if (!vercelToken || !deploymentId) {
    return res.status(400).json({ error: 'vercelToken and deploymentId required' });
  }

  try {
    const vercel = createVercelService(vercelToken);
    const redeployment = await vercel.redeploy(projectId, deploymentId);

    res.json({
      success: true,
      deployment: redeployment
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/projects', async (req, res) => {
  const { vercelToken, teamId } = req.query;

  if (!vercelToken) {
    return res.status(400).json({ error: 'vercelToken required' });
  }

  try {
    const vercel = createVercelService(vercelToken);
    const projects = await vercel.listProjects();

    res.json({
      success: true,
      projects: projects.projects || []
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

router.get('/deployment/:id', async (req, res) => {
  const { vercelToken } = req.query;
  const { id } = req.params;

  if (!vercelToken) {
    return res.status(400).json({ error: 'vercelToken required' });
  }

  try {
    const vercel = createVercelService(vercelToken);
    const deployment = await vercel.getDeployment(id);

    res.json({
      success: true,
      deployment
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = router;