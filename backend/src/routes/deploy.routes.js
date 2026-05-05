const express = require('express');
const router = express.Router();
const deployController = require('../controllers/deploy.controller');
const { analyzeProject } = require('../utils/analyzer');

// Analyze project structure (Intake & Analysis Engine)
router.post('/analyze', async (req, res) => {
  try {
    const { workDir } = req.body;
    if (!workDir) {
      return res.status(400).json({ error: 'workDir is required' });
    }
    const analysis = await analyzeProject(workDir);
    res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze project' });
  }
});

// Deploy a new project
router.post('/', deployController.deploy);

// Get all deployments
router.get('/', deployController.getDeployments);

// Get single deployment
router.get('/:id', deployController.getDeployment);

// Stop a deployment
router.post('/:id/stop', deployController.stopDeployment);

// Delete a deployment
router.delete('/:id', deployController.deleteDeployment);

// Restart a deployment
router.post('/:id/restart', deployController.restartDeployment);

module.exports = router;