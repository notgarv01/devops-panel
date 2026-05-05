const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { transformForDeployment, generateVercelConfig } = require('../utils/transformer');
const { analyzeProject, PROJECT_TYPES } = require('../utils/analyzer');

router.post('/transform', async (req, res) => {
  const io = req.app.get('io');

  try {
    const { workDir, projectType, options = {} } = req.body;

    if (!workDir) {
      return res.status(400).json({
        error: 'workDir is required',
        message: 'Please provide the path to the project directory'
      });
    }

    // Verify directory exists
    try {
      await fs.access(workDir);
    } catch {
      return res.status(400).json({
        error: 'Invalid path',
        message: 'Project directory does not exist or is not accessible'
      });
    }

    console.log(`[Transform] Starting transformation for: ${workDir}`);

    // Emit progress
    if (io) {
      io.emit('transform-progress', { stage: 'transform_start', message: 'Starting transformation...' });
    }

    // If no projectType provided, analyze first
    let detectedType = projectType;
    if (!detectedType || detectedType === 'auto') {
      const analysis = await analyzeProject(workDir);
      detectedType = analysis.projectType.type;
      console.log(`[Transform] Auto-detected type: ${detectedType}`);
    }

    // Run transformations
    const result = await transformForDeployment(workDir, detectedType, options);

    console.log(`[Transform] Completed: ${result.transformations.length} transformations`);
    console.log(`[Transform] Files created: ${result.files.join(', ')}`);

    // Emit completion
    if (io) {
      io.emit('transform-progress', {
        stage: 'transform_complete',
        files: result.files,
        transformations: result.transformations.length
      });
    }

    res.json({
      success: true,
      transformComplete: true,
      projectType: detectedType,
      result
    });

  } catch (error) {
    console.error('[Transform] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Transformation failed',
      message: error.message
    });
  }
});

router.post('/preview-vercel', async (req, res) => {
  try {
    const { projectType, config = {} } = req.body;

    if (!projectType) {
      return res.status(400).json({
        error: 'projectType is required'
      });
    }

    const vercelConfig = generateVercelConfig(projectType, config);

    res.json({
      success: true,
      config: vercelConfig,
      raw: JSON.stringify(vercelConfig, null, 2)
    });

  } catch (error) {
    console.error('[Transform] Preview error:', error);
    res.status(500).json({
      error: 'Preview generation failed',
      message: error.message
    });
  }
});

router.get('/templates', (req, res) => {
  res.json({
    templates: {
      STATIC: generateVercelConfig(PROJECT_TYPES.STATIC),
      NODE_API: generateVercelConfig(PROJECT_TYPES.NODE_API),
      FRONTEND_FRAMEWORK: generateVercelConfig(PROJECT_TYPES.FRONTEND_FRAMEWORK)
    }
  });
});

module.exports = router;