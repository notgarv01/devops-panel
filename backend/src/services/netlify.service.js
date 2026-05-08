const NETLIFY_API = 'https://api.netlify.com/api/v1';

class NetlifyService {
  constructor(accessToken) {
    this.token = accessToken;
    this.headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  async request(method, endpoint, data = null) {
    const url = `${NETLIFY_API}${endpoint}`;
    const options = {
      method,
      headers: this.headers
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.message || `Netlify API error: ${response.status}`);
    }

    return json;
  }

  // Verify access token
  async verifyToken() {
    try {
      const user = await this.request('GET', '/user');
      return {
        valid: true,
        user: {
          name: user.name,
          email: user.email,
          avatar: user.avatar
        }
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  // List sites
  async listSites() {
    return this.request('GET', '/sites');
  }

  // Get site
  async getSite(siteId) {
    return this.request('GET', `/sites/${siteId}`);
  }

  // Create new site
  async createSite(name, options = {}) {
    const data = {
      name,
      ...options
    };

    return this.request('POST', '/sites', data);
  }

  // Get deploys for a site
  async getDeploys(siteId) {
    return this.request('GET', `/sites/${siteId}/deploys`);
  }

  // Get specific deploy
  async getDeploy(siteId, deployId) {
    return this.request('GET', `/sites/${siteId}/deploys/${deployId}`);
  }

  // Trigger new deploy
  async createDeploy(siteId, deployData) {
    return this.request('POST', `/sites/${siteId}/deploys`, deployData);
  }

  // Upload file for deploy
  async uploadDeployFile(siteId, deployId, path, content) {
    const url = `${NETLIFY_API}/sites/${siteId}/deploys/${deployId}/files/${path}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/octet-stream'
      },
      body: content
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    return { success: true };
  }

  // Finalize deploy
  async finalizeDeploy(siteId, deployId) {
    return this.request('POST', `/sites/${siteId}/deploys/${deployId}/activate`);
  }

  // Get build settings
  async getBuildSettings(siteId) {
    return this.request('GET', `/sites/${siteId}`);
  }

  // Update build settings
  async updateBuildSettings(siteId, settings) {
    return this.request('PATCH', `/sites/${siteId}`, settings);
  }

  // Get env vars
  async getEnvVars(siteId) {
    return this.request('GET', `/sites/${siteId}/env`);
  }

  // Set env var
  async setEnvVar(siteId, key, value) {
    return this.request('POST', `/sites/${siteId}/env`, {
      key,
      value,
      context: 'all'
    });
  }

  // Delete env var
  async deleteEnvVar(siteId, key) {
    return this.request('DELETE', `/sites/${siteId}/env/${key}`);
  }

  // Mirror deploy from another platform
  async mirrorDeploy(siteId, files, buildCommand = null, publishDir = 'dist') {
    try {
      // Create new deploy
      const deploy = await this.createDeploy(siteId, {
        title: 'Mirrored deployment',
        buildCommand,
        publishDir
      });

      // Upload files (would need actual file content in production)
      // For now, just return the deploy
      return {
        success: true,
        deployId: deploy.id,
        deployUrl: deploy.deploy_url
      };
    } catch (error) {
      console.error('[Netlify] Mirror deploy failed:', error.message);
      throw error;
    }
  }

  // Get site SSL status
  async getSSL(siteId) {
    return this.request('GET', `/sites/${siteId}/ssl`);
  }
}

const createNetlifyService = (token) => {
  if (!token) {
    throw new Error('Netlify access token is required');
  }
  return new NetlifyService(token);
};

module.exports = { NetlifyService, createNetlifyService };