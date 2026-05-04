const express = require('express');
const router = express.Router();
const deployController = require('../controllers/deploy.controller');

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