const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');

// Get recent audit events
router.get('/', async (req, res) => {
  const { limit = 100, action, resource, project, severity } = req.query;

  try {
    const query = {};

    if (action) {
      query.action = action;
    }
    if (resource) {
      query.resource = { $regex: resource, $options: 'i' };
    }
    if (project) {
      query['project.name'] = project;
    }
    if (severity) {
      query.severity = severity;
    }

    const logs = await AuditLog.find(query)
      .sort({ timestamp: -1 })
      .limit(Math.min(parseInt(limit), 500))
      .lean();

    res.json({
      logs,
      count: logs.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get events for a specific resource
router.get('/resource/:resourceId', async (req, res) => {
  const { resourceId } = req.params;
  const { limit = 50 } = req.query;

  try {
    const logs = await AuditLog.find({ resourceId })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get events for a specific user
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const { limit = 50 } = req.query;

  try {
    const logs = await AuditLog.find({ 'actor.id': userId })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get security events only
router.get('/security', async (req, res) => {
  const { limit = 100 } = req.query;

  try {
    const logs = await AuditLog.find({
      severity: { $in: ['warning', 'critical'] }
    })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get stats/summary
router.get('/stats', async (req, res) => {
  const { hours = 24 } = req.query;

  try {
    const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);

    const stats = await AuditLog.aggregate([
      {
        $match: { timestamp: { $gte: since } }
      },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const severityCounts = await AuditLog.aggregate([
      {
        $match: { timestamp: { $gte: since } }
      },
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      stats,
      severityCounts,
      period: `last ${hours} hours`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export logs for compliance
router.get('/export', async (req, res) => {
  const { startDate, endDate, format = 'json' } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate required' });
  }

  try {
    const logs = await AuditLog.exportLogs(
      new Date(startDate),
      new Date(endDate)
    );

    if (format === 'csv') {
      // Generate CSV
      const csv = [
        'timestamp,action,resource,severity,actor,details'
      ];
      logs.forEach(log => {
        csv.push([
          log.timestamp.toISOString(),
          log.action,
          log.resource,
          log.severity,
          log.actor?.name || 'system',
          JSON.stringify(log.metadata || {})
        ].join(','));
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${startDate}-${endDate}.csv"`);
      return res.send(csv.join('\n'));
    }

    res.json({ logs, count: logs.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create audit log entry (internal use)
router.post('/', async (req, res) => {
  const { action, resource, resourceId, actor, changes, metadata, severity, project, stack } = req.body;

  if (!action || !resource) {
    return res.status(400).json({ error: 'action and resource are required' });
  }

  try {
    const log = await AuditLog.log({
      action,
      resource,
      resourceId,
      actor,
      changes,
      metadata,
      severity,
      project,
      stack
    });

    res.status(201).json(log);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;