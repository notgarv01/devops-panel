const express = require('express');
const router = express.Router();
const Stack = require('../models/Stack');
const Project = require('../models/Project');

// Create a new stack
router.post('/', async (req, res) => {
  const { name, description, owner, projects = [] } = req.body;

  if (!name || !owner) {
    return res.status(400).json({ error: 'name and owner are required' });
  }

  try {
    const stack = new Stack({
      name,
      description,
      owner,
      projects
    });

    await stack.save();
    res.status(201).json(stack);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Stack name already exists for this owner' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Get all stacks for an owner
router.get('/', async (req, res) => {
  const { owner } = req.query;

  if (!owner) {
    return res.status(400).json({ error: 'owner query param required' });
  }

  try {
    const stacks = await Stack.find({ owner })
      .populate('projects', 'name status vercelUrl githubUrl framework');
    res.json({ stacks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single stack with projects
router.get('/:id', async (req, res) => {
  try {
    const stack = await Stack.findById(req.params.id)
      .populate('projects', 'name status vercelUrl githubUrl framework targetBranch');

    if (!stack) {
      return res.status(404).json({ error: 'Stack not found' });
    }

    res.json(stack);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a stack
router.patch('/:id', async (req, res) => {
  const { name, description, autoSync, cascadeDeploy, deploymentOrder } = req.body;

  try {
    const stack = await Stack.findById(req.params.id);
    if (!stack) {
      return res.status(404).json({ error: 'Stack not found' });
    }

    if (name !== undefined) stack.name = name;
    if (description !== undefined) stack.description = description;
    if (autoSync !== undefined) stack.autoSync = autoSync;
    if (cascadeDeploy !== undefined) stack.cascadeDeploy = cascadeDeploy;
    if (deploymentOrder !== undefined) stack.deploymentOrder = deploymentOrder;

    await stack.save();
    res.json(stack);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a project to a stack
router.post('/:id/projects', async (req, res) => {
  const { projectId, stackRole = 'standalone' } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId required' });
  }

  try {
    const stack = await Stack.findById(req.params.id);
    if (!stack) {
      return res.status(404).json({ error: 'Stack not found' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if already in stack
    if (stack.projects.includes(projectId)) {
      return res.status(409).json({ error: 'Project already in stack' });
    }

    // Add to stack
    stack.projects.push(projectId);
    await stack.save();

    // Update project's stack reference
    project.stackId = stack._id;
    project.stackRole = stackRole;
    await project.save();

    res.json(stack);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove a project from a stack
router.delete('/:id/projects/:projectId', async (req, res) => {
  try {
    const stack = await Stack.findById(req.params.id);
    if (!stack) {
      return res.status(404).json({ error: 'Stack not found' });
    }

    const projectIndex = stack.projects.indexOf(req.params.projectId);
    if (projectIndex === -1) {
      return res.status(404).json({ error: 'Project not in stack' });
    }

    stack.projects.splice(projectIndex, 1);
    await stack.save();

    // Update project's stack reference
    await Project.findByIdAndUpdate(req.params.projectId, {
      stackId: null,
      stackRole: 'standalone'
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger cascade deployment for a stack
router.post('/:id/deploy', async (req, res) => {
  const { triggerProjectId, githubToken } = req.body;

  try {
    const stack = await Stack.findById(req.params.id)
      .populate('projects');

    if (!stack) {
      return res.status(404).json({ error: 'Stack not found' });
    }

    if (!stack.cascadeDeploy) {
      return res.json({ message: 'Cascade deploy disabled', triggered: 0 });
    }

    const results = [];
    const projectsToTrigger = stack.projects.filter(p =>
      p._id.toString() !== triggerProjectId
    );

    for (const project of projectsToTrigger) {
      // Trigger deployment for each project in stack
      results.push({
        projectId: project._id,
        name: project.name,
        status: 'triggered'
      });
    }

    res.json({
      success: true,
      triggered: results.length,
      deployments: results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a stack
router.delete('/:id', async (req, res) => {
  try {
    const stack = await Stack.findById(req.params.id);
    if (!stack) {
      return res.status(404).json({ error: 'Stack not found' });
    }

    // Clear stack reference from projects
    await Project.updateMany(
      { stackId: stack._id },
      { stackId: null, stackRole: 'standalone' }
    );

    await Stack.findByIdAndDelete(req.params.id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;