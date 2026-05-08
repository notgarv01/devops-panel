const express = require('express');
const router = express.Router();
const StatusPage = require('../models/StatusPage');
const AuditLog = require('../models/AuditLog');

// Get public status page data
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const page = await StatusPage.getPublicPage(slug);

    if (!page) {
      return res.status(404).json({ error: 'Status page not found or not published' });
    }

    res.json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get status by public API key (for embedding)
router.get('/embed/:apiKey', async (req, res) => {
  const { apiKey } = req.params;

  try {
    const page = await StatusPage.findOne({ publicApiKey: apiKey, published: true })
      .populate('projects.projectId');

    if (!page) {
      return res.status(404).json({ error: 'Invalid API key or status page not published' });
    }

    const summary = await page.getStatusSummary();

    res.json({
      name: page.name,
      slug: page.slug,
      ...summary,
      branding: page.branding
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new status page
router.post('/', async (req, res) => {
  const { name, slug, stackId, projects, branding, owner } = req.body;

  if (!name || !owner) {
    return res.status(400).json({ error: 'name and owner are required' });
  }

  try {
    // Generate slug if not provided
    const pageSlug = slug || StatusPage.generateSlug(name);

    // Check if slug exists
    const existing = await StatusPage.findOne({ slug: pageSlug });
    if (existing) {
      return res.status(409).json({ error: 'Slug already exists' });
    }

    const page = new StatusPage({
      name,
      slug: pageSlug,
      stackId,
      projects,
      branding,
      createdAt: new Date()
    });

    await page.save();

    // Log creation
    await AuditLog.log({
      action: 'status_page.created',
      resource: 'status_page',
      resourceId: page._id.toString(),
      actor: { id: owner, type: 'user' },
      metadata: { name, slug: pageSlug },
      severity: 'info'
    });

    res.status(201).json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update status page
router.patch('/:id', async (req, res) => {
  const { name, published, branding, projects } = req.body;

  try {
    const page = await StatusPage.findById(req.params.id);

    if (!page) {
      return res.status(404).json({ error: 'Status page not found' });
    }

    if (name) page.name = name;
    if (typeof published === 'boolean') page.published = published;
    if (branding) page.branding = { ...page.branding, ...branding };
    if (projects) page.projects = projects;

    await page.save();

    res.json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle publish status
router.post('/:id/publish', async (req, res) => {
  const { userId } = req.body;

  try {
    const page = await StatusPage.findById(req.params.id);

    if (!page) {
      return res.status(404).json({ error: 'Status page not found' });
    }

    page.published = !page.published;
    await page.save();

    // Log the action
    await AuditLog.log({
      action: page.published ? 'status_page.published' : 'status_page.unpublished',
      resource: 'status_page',
      resourceId: page._id.toString(),
      actor: { id: userId, type: 'user' },
      metadata: { slug: page.slug },
      severity: 'info'
    });

    res.json({ published: page.published, url: page.published ? `/status/${page.slug}` : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create incident
router.post('/:id/incidents', async (req, res) => {
  const { title, impact, userId } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const page = await StatusPage.findById(req.params.id);

    if (!page) {
      return res.status(404).json({ error: 'Status page not found' });
    }

    const incident = {
      id: `inc_${Date.now()}`,
      title,
      status: 'investigating',
      impact: impact || 'minor',
      startedAt: new Date(),
      updates: [{
        message: `Incident created: ${title}`,
        timestamp: new Date()
      }]
    };

    page.incidents.push(incident);
    await page.save();

    // Log incident creation
    await AuditLog.log({
      action: 'incident.created',
      resource: 'status_page',
      resourceId: page._id.toString(),
      actor: { id: userId, type: 'user' },
      metadata: { incidentId: incident.id, title },
      severity: 'critical'
    });

    res.status(201).json(incident);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update incident
router.patch('/:id/incidents/:incidentId', async (req, res) => {
  const { status, message, userId } = req.body;

  try {
    const page = await StatusPage.findById(req.params.id);

    if (!page) {
      return res.status(404).json({ error: 'Status page not found' });
    }

    const incident = page.incidents.find(i => i.id === req.params.incidentId);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    if (status) incident.status = status;
    if (message) {
      incident.updates.push({
        message,
        timestamp: new Date()
      });
    }
    if (status === 'resolved') {
      incident.resolvedAt = new Date();
    }

    await page.save();

    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete status page
router.delete('/:id', async (req, res) => {
  const { userId } = req.body;

  try {
    const page = await StatusPage.findById(req.params.id);

    if (!page) {
      return res.status(404).json({ error: 'Status page not found' });
    }

    await StatusPage.findByIdAndDelete(req.params.id);

    // Log deletion
    await AuditLog.log({
      action: 'status_page.deleted',
      resource: 'status_page',
      resourceId: req.params.id,
      actor: { id: userId, type: 'user' },
      metadata: { slug: page.slug },
      severity: 'warning'
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;