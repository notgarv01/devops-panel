const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');

// GitHub OAuth credentials from environment
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Encryption key for tokens (should be in .env in production)
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// Simple encryption/decryption for OAuth tokens
const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};

const decrypt = (text) => {
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch {
    return null;
  }
};

// Initiate GitHub OAuth
router.get('/github', (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(500).json({
      error: 'GitHub OAuth not configured',
      message: 'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in environment'
    });
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;

  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo,read:user,write:repo_hook&state=${state}`;

  res.json({
    url: githubAuthUrl,
    state
  });
});

// GitHub OAuth callback
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;

  // Verify state to prevent CSRF
  if (state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid OAuth state' });
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${BACKEND_URL}/api/auth/github/callback`
      },
      { headers: { Accept: 'application/json' } }
    );

    const { access_token, refresh_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token received from GitHub');
    }

    // Get user info from GitHub
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const githubUser = userResponse.data;

    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(access_token);
    const encryptedRefreshToken = refresh_token ? encrypt(refresh_token) : null;

    // Find or create user
    let user = await User.findOne({ 'github.id': githubUser.id });

    if (user) {
      // Update existing user
      user.github.accessToken = encryptedAccessToken;
      user.github.refreshToken = encryptedRefreshToken;
      user.github.username = githubUser.login;
      user.github.name = githubUser.name;
      user.github.avatar = githubUser.avatar_url;
    } else {
      // Create new user
      user = new User({
        github: {
          id: githubUser.id,
          username: githubUser.login,
          name: githubUser.name,
          avatar: githubUser.avatar_url,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken
        }
      });
    }

    await user.save();

    // Return success with user info (don't expose tokens)
    res.json({
      success: true,
      user: {
        id: user._id,
        github: {
          username: user.github.username,
          name: user.github.name,
          avatar: user.github.avatar
        },
        connected: true
      }
    });

  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.status(500).json({
      error: 'OAuth failed',
      message: error.message
    });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  // In a real app, this would use session/JWT to identify user
  // For now, we'll accept a userId query param for demo purposes
  const { userId } = req.query;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user._id,
      github: {
        username: user.github.username,
        name: user.github.name,
        avatar: user.github.avatar,
        connected: !!user.github.accessToken
      },
      vercel: {
        connected: !!user.vercel.token
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get decrypted GitHub token for API calls
router.get('/github/token', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await User.findById(userId);

    if (!user || !user.github.accessToken) {
      return res.status(404).json({ error: 'GitHub not connected' });
    }

    // Decrypt and return token
    const token = decrypt(user.github.accessToken);

    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve token' });
  }
});

// Store Vercel token
router.post('/vercel', async (req, res) => {
  const { userId, vercelToken } = req.body;

  if (!userId || !vercelToken) {
    return res.status(400).json({ error: 'userId and vercelToken required' });
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Encrypt Vercel token before storing
    user.vercel = {
      token: encrypt(vercelToken)
    };

    await user.save();

    res.json({ success: true, message: 'Vercel token saved' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save Vercel token' });
  }
});

// Get decrypted Vercel token
router.get('/vercel/token', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await User.findById(userId);

    if (!user || !user.vercel?.token) {
      return res.status(404).json({ error: 'Vercel not connected' });
    }

    const token = decrypt(user.vercel.token);

    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve token' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  const { userId } = req.body;

  if (userId) {
    try {
      await User.findByIdAndUpdate(userId, {
        'github.accessToken': null,
        'github.refreshToken': null
      });
    } catch {}
  }

  res.json({ success: true });
});

module.exports = router;