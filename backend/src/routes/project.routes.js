const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const { createVercelService } = require('../services/vercel.service');

// Get all projects
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({ status: { $ne: 'deleted' } })
      .sort({ lastDeployAt: -1, createdAt: -1 });

    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get single project
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create or update project (upsert)
router.post('/', async (req, res) => {
  try {
    const {
      name,
      owner,
      repoUrl,
      targetBranch,
      vercelProjectId,
      vercelUrl,
      githubUrl,
      framework,
      environment
    } = req.body;

    const project = await Project.findOneAndUpdate(
      { name },
      {
        $set: {
          owner,
          repoUrl,
          targetBranch: targetBranch || `devops-deploy-${name.slice(0, 8).toLowerCase()}`,
          vercelProjectId,
          vercelUrl,
          githubUrl,
          framework: framework || 'unknown',
          environment: environment || 'production',
          lastDeployAt: new Date(),
          status: 'live'
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { new: true, upsert: true }
    );

    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to save project' });
  }
});

// Update project status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const project = await Project.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Update last webhook time
router.patch('/:id/webhook', async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(
      req.params.id,
      { lastWebhookAt: new Date(), updatedAt: new Date() },
      { new: true }
    );

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update webhook time' });
  }
});

// Add custom domain
router.post('/:id/domain', async (req, res) => {
  try {
    const { vercelToken, domain } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!vercelToken) {
      return res.status(400).json({ error: 'Vercel token required' });
    }

    const vercel = createVercelService(vercelToken);

    // Add domain to Vercel project
    if (project.vercelProjectId) {
      try {
        await vercel.addDomain(project.vercelProjectId, domain);

        // Verify domain
        const verification = await vercel.verifyDomain(project.vercelProjectId, domain);

        res.json({
          success: true,
          domain,
          verification,
          message: 'Domain added and verification requested'
        });
      } catch (vercelError) {
        res.status(400).json({
          error: 'Failed to add domain',
          details: vercelError.message
        });
      }
    } else {
      res.status(400).json({ error: 'No Vercel project linked' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to add domain' });
  }
});

// Get deployment history
router.get('/:id/deployments', async (req, res) => {
  try {
    const { vercelToken } = req.query;
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!vercelToken || !project.vercelProjectId) {
      return res.json({ deployments: [] });
    }

    const vercel = createVercelService(vercelToken);
    const deployments = await vercel.listDeployments(project.vercelProjectId);

    res.json({
      deployments: deployments.deployments || [],
      projectId: project.vercelProjectId
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

// Trigger rollback
router.post('/:id/rollback', async (req, res) => {
  try {
    const { vercelToken, deploymentId } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!vercelToken || !project.vercelProjectId) {
      return res.status(400).json({ error: 'Vercel token or project ID missing' });
    }

    const vercel = createVercelService(vercelToken);

    if (deploymentId) {
      // Redeploy specific deployment
      const deployment = await vercel.redeploy(project.vercelProjectId, deploymentId);

      res.json({
        success: true,
        message: 'Rollback initiated',
        deployment: deployment
      });
    } else {
      // Redeploy from GitHub (current state of branch)
      const deployment = await vercel.createDeployment({
        name: project.name,
        gitSource: {
          type: 'github',
          repo: `${project.owner}/${project.name}`,
          ref: project.targetBranch
        }
      });

      res.json({
        success: true,
        message: 'Redeploy initiated',
        deployment: deployment
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger rollback' });
  }
});

// Delete project (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(
      req.params.id,
      { status: 'deleted', updatedAt: new Date() },
      { new: true }
    );

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ message: 'Project deleted', project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;