const express = require('express');
const router = express.Router();
const { runTransformationPipeline } = require('../services/orchestrator');
const { getQueueManager, initQueueManager } = require('../services/queueManager');
const AuditLog = require('../models/AuditLog');
const Project = require('../models/Project');

// Initialize queue manager
const queueManager = initQueueManager(process.env.REDIS_URL || null);

// Process queue worker
const processDeployment = async (jobData, job) => {
  const { id, projectPath, githubToken, vercelToken, projectName, branch, envVars, options, userId } = jobData;

  console.log(`[Pipeline:${id}] Worker picked up job`);

  // Get io from global (set in index.js)
  const io = global.io;

  // Safety: 5 minute timeout for entire pipeline
  const pipelineTimeout = setTimeout(() => {
    console.error(`[Pipeline:${id}] Pipeline timed out after 5 minutes`);
    if (io) {
      io.to(id).emit('pipeline-log', {
        sessionId: id,
        timestamp: new Date(),
        level: 'error',
        message: 'Pipeline timed out after 5 minutes'
      });
    }
  }, 5 * 60 * 1000);

  try {
    const result = await runTransformationPipeline(io, id, {
      projectPath,
      githubToken,
      vercelToken,
      projectName,
      branch,
      envVars,
      options
    });

    clearTimeout(pipelineTimeout);
    console.log(`[Pipeline:${id}] Complete:`, result);

    // Log completion
    await AuditLog.log({
      action: 'deployment.completed',
      resource: 'pipeline',
      resourceId: id,
      actor: { id: userId, type: 'user' },
      metadata: result,
      project: { name: projectName },
      severity: 'info'
    });

    return result;
  } catch (error) {
    clearTimeout(pipelineTimeout);
    console.error(`[Pipeline:${id}] Failed:`, error.message);

    // Log failure
    await AuditLog.log({
      action: 'deployment.failed',
      resource: 'pipeline',
      resourceId: id,
      actor: { id: userId, type: 'user' },
      metadata: { error: error.message },
      project: { name: projectName },
      severity: 'warning'
    });

    if (io) {
      io.to(id).emit('pipeline-log', {
        sessionId: id,
        timestamp: new Date(),
        level: 'error',
        message: `Pipeline error: ${error.message}`
      });
      io.to(id).emit('pipeline-error', {
        sessionId: id,
        error: error.message
      });
    }

    throw error;
  }
};

// Start processing queue
queueManager.processQueue('deployments', processDeployment, 2);

router.post('/run', async (req, res) => {
  const io = req.app.get('io');

  const {
    projectPath,
    githubToken,
    vercelToken,
    projectName,
    branch = 'main',
    envVars = [],
    options = {},
    sessionId,
    userId,
    workspaceId
  } = req.body;

  // Validation
  if (!projectPath) {
    return res.status(400).json({
      success: false,
      error: 'projectPath is required'
    });
  }

  if (!githubToken) {
    return res.status(400).json({
      success: false,
      error: 'githubToken is required'
    });
  }

  // Use provided sessionId or generate new one
  const id = sessionId || `pipeline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // PRE-ENQUEUE: Save/update project in MongoDB FIRST for dashboard visibility
  try {
    const existingProject = await Project.findOne({ name: projectName });
    if (existingProject) {
      await Project.findByIdAndUpdate(existingProject._id, {
        status: 'queued',
        repoUrl: projectPath,
        githubUrl: projectPath,
        lastDeployAt: new Date(),
        sessionId: id
      });
    } else {
      const newProject = new Project({
        name: projectName,
        repoUrl: projectPath,
        githubUrl: projectPath,
        status: 'queued',
        sessionId: id,
        lastDeployAt: new Date()
      });
      await newProject.save();
    }
    console.log(`[Pipeline:${id}] Project record created/updated in MongoDB`);
  } catch (dbError) {
    console.error(`[Pipeline:${id}] Failed to save project record:`, dbError.message);
    // Continue anyway - the job will still run
  }

  // Get queue status for position
  const queueStatus = queueManager.getQueueStatus('deployments');
  const queuePosition = queueStatus.waiting + queueStatus.active + 1;

  // Return immediately with session ID
  res.status(202).json({
    success: true,
    message: 'Pipeline queued',
    sessionId: id,
    queuePosition,
    queueTotal: queuePosition,
    stages: ['fetch', 'analyze', 'scan', 'transform', 'github-sync', vercelToken ? 'vercel-deploy' : 'complete']
  });

  console.log(`[Pipeline:${id}] Queued at position #${queuePosition}`);

  // Log the enqueue event
  try {
    await AuditLog.log({
      action: 'deployment.started',
      resource: 'pipeline',
      resourceId: id,
      actor: { id: userId, type: 'user' },
      metadata: {
        projectPath,
        projectName,
        branch,
        queuePosition
      },
      project: { name: projectName },
      severity: 'info'
    });
  } catch (e) {
    console.log('[Audit] Failed to log:', e.message);
  }

  // Enqueue the job (don't pass io - use global.io in worker)
  const job = await queueManager.addJob('deployments', 'run-pipeline', {
    id,
    projectPath,
    githubToken,
    vercelToken,
    projectName,
    branch,
    envVars,
    options,
    userId
  });

  // Notify queue position
  if (io) {
    io.to(id).emit('queue-position', {
      sessionId: id,
      position: queuePosition,
      total: queuePosition
    });
  }
});

// Health check / status
router.get('/status/:sessionId', (req, res) => {
  res.json({
    sessionId: req.params.sessionId,
    status: 'ok',
    message: 'Pipeline tracking via WebSocket'
  });
});

module.exports = router;