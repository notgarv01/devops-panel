const express = require('express');
const router = express.Router();
const { runTransformationPipeline } = require('../services/orchestrator');

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
    sessionId // Optional: use client-provided sessionId
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

  // Return immediately with session ID
  res.status(202).json({
    success: true,
    message: 'Pipeline started',
    sessionId: id,
    stages: ['fetch', 'analyze', 'transform', 'github-sync', vercelToken ? 'vercel-deploy' : 'complete']
  });

  console.log(`[Pipeline:${id}] Starting with config:`, { projectPath, projectName });

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

  // Run pipeline
  runTransformationPipeline(io, id, {
    projectPath,
    githubToken,
    vercelToken,
    projectName,
    branch,
    envVars,
    options
  })
  .then(result => {
    clearTimeout(pipelineTimeout);
    console.log(`[Pipeline:${id}] Complete:`, result);
  })
  .catch(error => {
    clearTimeout(pipelineTimeout);
    console.error(`[Pipeline:${id}] Failed:`, error.message);
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
  });
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