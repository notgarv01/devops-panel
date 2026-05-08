const express = require('express');
const router = express.Router();
const { startJanitor, stopJanitor, triggerJanitor } = require('../services/janitor.service');

// Start the janitor service
router.post('/start', (req, res) => {
  const { githubToken } = req.body;

  if (!githubToken) {
    return res.status(400).json({ error: 'GitHub token required' });
  }

  try {
    startJanitor(githubToken, 24); // Run every 24 hours
    res.json({ success: true, message: 'Janitor service started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop the janitor service
router.post('/stop', (req, res) => {
  stopJanitor();
  res.json({ success: true, message: 'Janitor service stopped' });
});

// Trigger manual cleanup
router.post('/run', async (req, res) => {
  const { githubToken } = req.body;

  if (!githubToken) {
    return res.status(400).json({ error: 'GitHub token required' });
  }

  try {
    const results = await triggerJanitor(githubToken);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get scheduled branches info
router.get('/branches', async (req, res) => {
  const { triggerJanitor } = require('../services/janitor.service');

  try {
    const janitor = new (require('../services/janitor.service').JanitorService)(req.query.githubToken || '');
    const branches = await janitor.getPrunedBranches();
    res.json({ branches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;