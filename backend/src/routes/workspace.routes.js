const express = require('express');
const router = express.Router();
const Workspace = require('../models/Workspace');
const AuditLog = require('../models/AuditLog');

// Create a new workspace
router.post('/', async (req, res) => {
  const { name, description, owner, settings } = req.body;

  if (!name || !owner) {
    return res.status(400).json({ error: 'name and owner are required' });
  }

  try {
    // Generate slug
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Check if slug already exists
    const existing = await Workspace.findOne({ slug });
    if (existing) {
      return res.status(409).json({ error: 'Workspace name already exists' });
    }

    const workspace = new Workspace({
      name,
      slug,
      description,
      owner,
      settings
    });

    await workspace.save();

    // Log the action
    await AuditLog.log({
      action: 'workspace.created',
      resource: 'workspace',
      resourceId: workspace._id.toString(),
      actor: { id: owner, type: 'user', name: owner },
      metadata: { workspaceName: name, slug },
      severity: 'info'
    });

    res.status(201).json(workspace);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all workspaces for current user
router.get('/me', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query param required' });
  }

  try {
    const workspaces = await Workspace.findForUser(userId);
    res.json({ workspaces });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get workspace by slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const workspace = await Workspace.findBySlug(req.params.slug);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    res.json(workspace);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get workspace by ID
router.get('/:id', async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    res.json(workspace);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update workspace
router.patch('/:id', async (req, res) => {
  const { userId, name, description, settings, limits } = req.body;

  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Check permission
    if (!workspace.hasPermission(userId, 'settings:write')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (name) workspace.name = name;
    if (description !== undefined) workspace.description = description;
    if (settings) workspace.settings = { ...workspace.settings, ...settings };
    if (limits) workspace.limits = { ...workspace.limits, ...limits };

    await workspace.save();

    res.json(workspace);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Invite member to workspace
router.post('/:id/invite', async (req, res) => {
  const { userId, email, name, role = 'viewer', invitedBy } = req.body;

  if (!userId || !email) {
    return res.status(400).json({ error: 'userId and email are required' });
  }

  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Check permission
    if (!workspace.hasPermission(invitedBy, 'team:invite')) {
      return res.status(403).json({ error: 'Only admins can invite members' });
    }

    const result = workspace.addMember({ userId, email, name, invitedBy }, role);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    await workspace.save();

    // Log the action
    await AuditLog.log({
      action: 'team.invited',
      resource: 'workspace',
      resourceId: workspace._id.toString(),
      actor: { id: invitedBy, type: 'user' },
      metadata: { invitedUser: email, role },
      severity: 'info'
    });

    res.json({ success: true, members: workspace.members });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove member from workspace
router.delete('/:id/members/:userId', async (req, res) => {
  const { initiatorId } = req.body;
  const { userId } = req.params;

  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Check permission
    if (!workspace.hasPermission(initiatorId, 'team:remove')) {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }

    // Cannot remove owner
    if (workspace.owner === userId) {
      return res.status(400).json({ error: 'Cannot remove workspace owner' });
    }

    const result = workspace.removeMember(userId);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    await workspace.save();

    // Log the action
    await AuditLog.log({
      action: 'team.removed',
      resource: 'workspace',
      resourceId: workspace._id.toString(),
      actor: { id: initiatorId, type: 'user' },
      metadata: { removedUserId: userId },
      severity: 'info'
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update member role
router.patch('/:id/members/:userId', async (req, res) => {
  const { role, initiatorId } = req.body;
  const { userId } = req.params;

  if (!role) {
    return res.status(400).json({ error: 'New role is required' });
  }

  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Check permission
    if (!workspace.hasPermission(initiatorId, 'team:change_role')) {
      return res.status(403).json({ error: 'Only admins can change roles' });
    }

    const result = workspace.updateMemberRole(userId, role);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    await workspace.save();

    // Log the action
    await AuditLog.log({
      action: 'team.role_changed',
      resource: 'workspace',
      resourceId: workspace._id.toString(),
      actor: { id: initiatorId, type: 'user' },
      metadata: { targetUserId: userId, newRole: role },
      severity: 'info'
    });

    res.json({ success: true, members: workspace.members });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete workspace
router.delete('/:id', async (req, res) => {
  const { userId } = req.body;

  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Only owner can delete
    if (workspace.owner !== userId) {
      return res.status(403).json({ error: 'Only the workspace owner can delete it' });
    }

    await Workspace.findByIdAndDelete(req.params.id);

    // Log the action
    await AuditLog.log({
      action: 'workspace.deleted',
      resource: 'workspace',
      resourceId: req.params.id,
      actor: { id: userId, type: 'user' },
      metadata: { workspaceName: workspace.name },
      severity: 'warning'
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get member permissions
router.get('/:id/permissions/:userId', async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const role = workspace.getUserRole(req.params.userId);

    if (!role) {
      return res.status(404).json({ error: 'User is not a member of this workspace' });
    }

    // Calculate permissions
    const permissions = Object.entries(require('../models/Workspace').PERMISSIONS || {})
      .filter(([_, allowedRoles]) => {
        const roleLevel = require('../models/Workspace').ROLES[role] || 0;
        return allowedRoles.some(r => (require('../models/Workspace').ROLES[r] || 0) <= roleLevel);
      })
      .map(([permission]) => permission);

    res.json({
      role,
      permissions,
      isOwner: role === 'owner'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;