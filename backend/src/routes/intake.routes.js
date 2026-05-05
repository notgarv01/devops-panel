const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { analyzeProject, PROJECT_TYPES } = require('../utils/analyzer');

router.post('/intake', async (req, res) => {
  const io = req.app.get('io');

  try {
    const { projectPath } = req.body;

    if (!projectPath) {
      return res.status(400).json({
        error: 'projectPath is required',
        message: 'Please provide the path to the project directory'
      });
    }

    // Verify directory exists
    try {
      await fs.access(projectPath);
    } catch {
      return res.status(400).json({
        error: 'Invalid path',
        message: 'Project directory does not exist or is not accessible'
      });
    }

    console.log(`[Intake] Analyzing project at: ${projectPath}`);

    // Run analysis
    const analysis = await analyzeProject(projectPath);

    // Emit progress if socket available
    if (io) {
      io.emit('analysis-progress', {
        stage: 'intake_complete',
        projectType: analysis.projectType.type,
        confidence: analysis.projectType.confidence,
        signals: analysis.projectType.signals
      });
    }

    console.log(`[Intake] Detected: ${analysis.projectType.type} (${(analysis.projectType.confidence * 100).toFixed(0)}%)`);

    res.json({
      success: true,
      intakeComplete: true,
      analysis
    });

  } catch (error) {
    console.error('[Intake] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Analysis failed',
      message: error.message
    });
  }
});

router.get('/types', (req, res) => {
  res.json({
    types: PROJECT_TYPES,
    description: {
      STATIC: 'Pure HTML/CSS/JS sites without build tools',
      NODE_API: 'Backend services with Node.js (Express, Koa, Fastify, etc.)',
      FRONTEND_FRAMEWORK: 'React, Vue, Angular, Next.js, Nuxt.js apps'
    }
  });
});

module.exports = router;