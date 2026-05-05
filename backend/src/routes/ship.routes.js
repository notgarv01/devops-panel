const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { createGitHubService } = require('../services/github.service');
const { createGitHubPushService } = require('../services/git.service');
const { analyzeProject, PROJECT_TYPES } = require('../utils/analyzer');
const { transformForDeployment } = require('../utils/transformer');

const log = (io, sessionId, level, message) => {
  const entry = {
    sessionId,
    timestamp: new Date(),
    level,
    message
  };

  if (io) {
    io.to(sessionId).emit('ship-log', entry);
  }
  console.log(`[Ship:${sessionId}] [${level}] ${message}`);
};

const sanitizeRepoName = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
};

router.post('/deploy', async (req, res) => {
  const io = req.app.get('io');
  const {
    githubToken,
    repoName,
    projectPath,
    branch = 'main',
    projectType = 'auto',
    options = {}
  } = req.body;

  // Validation
  if (!githubToken) {
    return res.status(400).json({
      error: 'GitHub token is required',
      message: 'Please provide a GitHub personal access token'
    });
  }

  if (!projectPath) {
    return res.status(400).json({
      error: 'projectPath is required',
      message: 'Please provide the path to the project directory'
    });
  }

  // Verify project path
  try {
    await fs.access(projectPath);
  } catch {
    return res.status(400).json({
      error: 'Invalid project path',
      message: 'Project directory does not exist or is not accessible'
    });
  }

  // Generate session ID for tracking
  const sessionId = `ship-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Return immediately, process async
  res.status(202).json({
    success: true,
    message: 'Deployment pipeline started',
    sessionId,
    stages: ['intake', 'transform', 'ship']
  });

  // Start pipeline
  startPipeline(sessionId, {
    githubToken,
    repoName: sanitizeRepoName(repoName || path.basename(projectPath)),
    projectPath,
    branch,
    projectType,
    options,
    io
  });
});

const startPipeline = async (sessionId, config) => {
  const {
    githubToken,
    repoName,
    projectPath,
    branch,
    projectType,
    options,
    io
  } = config;

  const workDir = projectPath;
  const github = createGitHubService(githubToken);
  const gitPush = createGitHubPushService(githubToken);

  try {
    // ===== STAGE 1: INTAKE =====
    log(io, sessionId, 'info', 'Stage 1/3: Analyzing project...');

    const analysis = await analyzeProject(workDir);
    const detectedType = projectType === 'auto' ? analysis.projectType.type : projectType;

    log(io, sessionId, 'info', `Detected type: ${detectedType} (${(analysis.projectType.confidence * 100).toFixed(0)}% confidence)`);
    log(io, sessionId, 'info', `Signals: ${analysis.projectType.signals.join(', ')}`);

    // ===== STAGE 2: TRANSFORM =====
    log(io, sessionId, 'info', 'Stage 2/3: Transforming project...');

    const transformResult = await transformForDeployment(workDir, detectedType, {
      includeNowJson: options.includeNowJson || false
    });

    log(io, sessionId, 'success', `Created ${transformResult.files.length} files:`);
    transformResult.files.forEach(f => {
      log(io, sessionId, 'info', `  + ${path.relative(workDir, f)}`);
    });

    // ===== STAGE 3: SHIP =====
    log(io, sessionId, 'info', 'Stage 3/3: Syncing to GitHub...');

    // Get authenticated user
    const user = await github.getAuthenticatedUser();
    const owner = user.login;

    log(io, sessionId, 'info', `Authenticated as: ${user.name || owner}`);

    // Create repository
    log(io, sessionId, 'info', `Creating repository: ${owner}/${repoName}`);

    let repo;
    try {
      repo = await github.createRepository({
        name: repoName,
        description: `Deployed via DevOps Panel - ${detectedType} project`,
        private: options.private !== false,
        autoInit: true
      });
      log(io, sessionId, 'success', `Repository created: ${repo.html_url}`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        log(io, sessionId, 'warning', 'Repository already exists, using existing one');
        repo = await github.getRepository(owner, repoName);
      } else {
        throw error;
      }
    }

    // Setup webhook
    if (options.webhookUrl) {
      try {
        const webhook = await github.createWebhook(owner, repoName, options.webhookUrl, ['push']);
        log(io, sessionId, 'info', `Webhook configured: ${webhook.url}`);
      } catch (error) {
        log(io, sessionId, 'warning', `Webhook setup failed: ${error.message}`);
      }
    }

    // Push code to GitHub
    log(io, sessionId, 'info', 'Pushing code to repository...');

    const remoteUrl = repo.clone_url;
    const pushResult = await gitPush.pushToGithub(workDir, remoteUrl, {
      branch,
      message: `Deploy ${detectedType} project via DevOps Panel`,
      force: true
    });

    if (pushResult.success) {
      log(io, sessionId, 'success', `Code pushed to ${branch} branch`);

      // Final summary
      log(io, sessionId, 'success', '===== Deployment Complete =====');
      log(io, sessionId, 'info', `Repository: ${repo.html_url}`);
      log(io, sessionId, 'info', `Branch: ${branch}`);
      log(io, sessionId, 'info', `Type: ${detectedType}`);
      log(io, sessionId, 'info', `Files: ${transformResult.files.length}`);
    } else {
      throw new Error(pushResult.error || 'Push failed');
    }

  } catch (error) {
    log(io, sessionId, 'error', `Pipeline failed: ${error.message}`);
    console.error(`[Ship:${sessionId}] Error:`, error);
  }
};

router.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const github = createGitHubService(token);
    const user = await github.getAuthenticatedUser();

    res.json({
      valid: true,
      user: {
        login: user.login,
        name: user.name,
        avatar: user.avatar_url,
        repos: user.total_private_repos + user.public_repos
      }
    });

  } catch (error) {
    res.status(401).json({
      valid: false,
      error: 'Invalid or expired token'
    });
  }
});

router.get('/templates', (req, res) => {
  res.json({
    projectTypes: PROJECT_TYPES,
    templates: {
      STATIC: {
        vercel: {
          version: 2,
          builds: [{ src: 'index.html', use: '@vercel/static' }]
        }
      },
      NODE_API: {
        vercel: {
          version: 2,
          builds: [{ src: 'api/**/*.js', use: '@vercel/node' }],
          rewrites: [
            { source: '/api/(.*)', destination: '/api/index.js' },
            { source: '/(.*)', destination: '/index.html' }
          ]
        }
      },
      FRONTEND_FRAMEWORK: {
        vercel: {
          version: 2,
          builds: [{ src: 'package.json', use: '@vercel/static-build', config: { distDir: 'dist' } }],
          rewrites: [{ source: '/(.*)', destination: '/index.html' }]
        }
      }
    }
  });
});

module.exports = router;