const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');

// In-memory notification configs (in production, use database)
const notificationConfigs = new Map();

// Supported notification channels
const CHANNELS = {
  slack: 'slack',
  discord: 'discord',
  telegram: 'telegram'
};

// Format notification payload for different channels
const formatSlackMessage = (data) => {
  const color = data.status === 'live' ? '#10B981' : '#EF4444';
  const emoji = data.status === 'live' ? '🚀' : '⚠️';

  return {
    attachments: [{
      color,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} ${data.project} Deployment ${data.status === 'live' ? 'Successful' : 'Failed'}`
          }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Project:*\n${data.project}` },
            { type: 'mrkdwn', text: `*Status:*\n${data.status.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Duration:*\n${data.duration}s` },
            { type: 'mrkdwn', text: `*Time:*\n${new Date().toISOString()}` }
          ]
        },
        ...(data.diagnosis ? [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*AI Diagnosis:*\n${data.diagnosis}`
          }
        }] : []),
        ...(data.url ? [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*URL:* <${data.url}|Open Deployment>`
          }
        }] : [])
      ]
    }]
  };
};

const formatDiscordMessage = (data) => {
  const color = data.status === 'live' ? 0x10B981 : 0xEF4444;
  const emoji = data.status === 'live' ? '🚀' : '⚠️';

  return {
    embeds: [{
      title: `${emoji} ${data.project} - ${data.status === 'live' ? 'Deployed' : 'Failed'}`,
      color,
      fields: [
        { name: 'Status', value: data.status.toUpperCase(), inline: true },
        { name: 'Duration', value: `${data.duration}s`, inline: true },
        { name: 'Time', value: new Date().toISOString(), inline: true }
      ],
      ...(data.diagnosis && {
        fields: [
          ...[{ name: 'Status', value: data.status.toUpperCase(), inline: true }],
          ...[{ name: 'Duration', value: `${data.duration}s`, inline: true }],
          ...[{ name: 'AI Diagnosis', value: data.diagnosis.substring(0, 1024) }]
        ]
      }),
      ...(data.url && {
        url: data.url
      }),
      timestamp: new Date().toISOString()
    }]
  };
};

const formatTelegramMessage = (data) => {
  const emoji = data.status === 'live' ? '🚀' : '⚠️';

  let message = `${emoji} *${data.project}* Deployment ${data.status === 'live' ? 'Successful' : 'Failed'}\n\n`;
  message += `📊 Status: *${data.status.toUpperCase()}*\n`;
  message += `⏱️ Duration: *${data.duration}s*\n`;

  if (data.diagnosis) {
    message += `\n🩺 AI Diagnosis:\n_${data.diagnosis.substring(0, 500)}_`;
  }

  if (data.url) {
    message += `\n🔗 URL: ${data.url}`;
  }

  return { text: message, parse_mode: 'Markdown' };
};

// Send notification to channel
const sendNotification = async (channel, webhookUrl, data) => {
  let payload;
  let headers = {};

  switch (channel) {
    case CHANNELS.slack:
      payload = formatSlackMessage(data);
      headers = { 'Content-Type': 'application/json' };
      break;

    case CHANNELS.discord:
      payload = formatDiscordMessage(data);
      headers = { 'Content-Type': 'application/json' };
      break;

    case CHANNELS.telegram:
      payload = formatTelegramMessage(data);
      headers = { 'Content-Type': 'application/json' };
      break;

    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }

  const response = await axios.post(webhookUrl, payload, { headers });
  return response.data;
};

// Configure notification channel for a project
router.post('/configure', async (req, res) => {
  const { projectName, channel, webhookUrl, events = ['success', 'failure'] } = req.body;

  if (!projectName || !channel || !webhookUrl) {
    return res.status(400).json({ error: 'projectName, channel, and webhookUrl are required' });
  }

  if (!Object.values(CHANNELS).includes(channel)) {
    return res.status(400).json({
      error: `Invalid channel. Supported: ${Object.values(CHANNELS).join(', ')}`
    });
  }

  // Generate secret for verification
  const secret = crypto.randomBytes(16).toString('hex');

  // Store config
  const config = {
    channel,
    webhookUrl,
    events,
    secret,
    createdAt: new Date()
  };

  notificationConfigs.set(projectName, config);

  res.json({
    success: true,
    message: `${channel} notification configured for ${projectName}`,
    webhookUrl: webhookUrl.substring(0, 30) + '...',
    secret
  });
});

// Get notification config
router.get('/config/:projectName', (req, res) => {
  const config = notificationConfigs.get(req.params.projectName);

  if (!config) {
    return res.status(404).json({ error: 'No notification config found' });
  }

  res.json({
    channel: config.channel,
    events: config.events,
    createdAt: config.createdAt
  });
});

// Remove notification config
router.delete('/config/:projectName', (req, res) => {
  const existed = notificationConfigs.has(req.params.projectName);
  notificationConfigs.delete(req.params.projectName);

  res.json({
    success: true,
    removed: existed
  });
});

// Test notification
router.post('/test/:projectName', async (req, res) => {
  const config = notificationConfigs.get(req.params.projectName);

  if (!config) {
    return res.status(404).json({ error: 'No notification config found' });
  }

  try {
    await sendNotification(config.channel, config.webhookUrl, {
      project: req.params.projectName,
      status: 'test',
      duration: 0,
      diagnosis: 'This is a test notification from DevOps Panel',
      url: null
    });

    res.json({ success: true, message: 'Test notification sent' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send notification endpoint (called by orchestrator)
router.post('/send', async (req, res) => {
  const { projectName, status, duration, diagnosis, url } = req.body;

  if (!projectName || !status) {
    return res.status(400).json({ error: 'projectName and status are required' });
  }

  const config = notificationConfigs.get(projectName);

  if (!config) {
    return res.status(404).json({ error: 'No notification config for this project' });
  }

  // Check if we should notify for this event
  if (!config.events.includes(status) && !config.events.includes('all')) {
    return res.json({ success: true, message: 'Notification not configured for this event' });
  }

  try {
    await sendNotification(config.channel, config.webhookUrl, {
      project: projectName,
      status,
      duration: duration || 0,
      diagnosis,
      url
    });

    res.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all configured projects
router.get('/list', (req, res) => {
  const projects = [];

  for (const [name, config] of notificationConfigs) {
    projects.push({
      projectName: name,
      channel: config.channel,
      events: config.events,
      createdAt: config.createdAt
    });
  }

  res.json({ projects });
});

module.exports = router;