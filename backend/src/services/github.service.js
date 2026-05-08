const crypto = require('crypto');

const GITHUB_API = 'https://api.github.com';

// Store webhook secrets (in production, use a database)
const webhookSecrets = new Map();

class GitHubService {
  constructor(token) {
    this.token = token;
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async request(method, endpoint, data = null) {
    const url = `${GITHUB_API}${endpoint}`;
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
      throw new Error(json.message || `GitHub API error: ${response.status}`);
    }

    return json;
  }

  async createRepository(repoData) {
    const {
      name,
      description = '',
      isPrivate = true,
      autoInit = false,
      hasIssues = true,
      hasWiki = false,
      hasPages = false
    } = repoData;

    return this.request('POST', '/user/repos', {
      name,
      description,
      private: isPrivate,
      auto_init: autoInit,
      has_issues: hasIssues,
      has_wiki: hasWiki,
      has_pages: hasPages
    });
  }

  async getRepository(owner, repo) {
    return this.request('GET', `/repos/${owner}/${repo}`);
  }

  async getRepoId(owner, repo) {
    const data = await this.request('GET', `/repos/${owner}/${repo}`);
    return data.id; // Numeric GitHub repo ID
  }

  async listRepositories() {
    return this.request('GET', '/user/repos?per_page=100&sort=updated');
  }

  async deleteRepository(owner, repo) {
    return this.request('DELETE', `/repos/${owner}/${repo}`);
  }

  async createOrUpdateFile(owner, repo, branch, filePath, content, message, sha = null) {
    const endpoint = `/repos/${owner}/${repo}/contents/${filePath}`;
    const data = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch
    };

    if (sha) {
      data.sha = sha;
    }

    return this.request('PUT', endpoint, data);
  }

  async getFileSha(owner, repo, filePath, branch = 'main') {
    try {
      const result = await this.request('GET', `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`);
      return result.sha;
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async createBranch(owner, repo, newBranch, sourceBranch = 'main') {
    // Get source branch ref
    const refResult = await this.request('GET', `/repos/${owner}/${repo}/git/ref/heads/${sourceBranch}`);

    return this.request('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${newBranch}`,
      sha: refResult.object.sha
    });
  }

  async createWebhook(owner, repo, webhookUrl, events = ['push', 'repository']) {
    // Generate and store secret for this repo
    const secret = crypto.randomBytes(32).toString('hex');
    const repoKey = `${owner}/${repo}`;
    webhookSecrets.set(repoKey, secret);

    const webhook = await this.request('POST', `/repos/${owner}/${repo}/hooks`, {
      name: 'web',
      active: true,
      events,
      config: {
        url: webhookUrl,
        content_type: 'json',
        insecure_ssl: '0',
        secret: secret
      }
    });

    return {
      id: webhook.id,
      url: webhook.url,
      secret
    };
  }

  // Get stored webhook secret for a repo
  getWebhookSecret(owner, repo) {
    return webhookSecrets.get(`${owner}/${repo}`);
  }

  // Store webhook secret
  storeWebhookSecret(owner, repo, secret) {
    webhookSecrets.set(`${owner}/${repo}`, secret);
  }

  async listWebhooks(owner, repo) {
    return this.request('GET', `/repos/${owner}/${repo}/hooks`);
  }

  async deleteWebhook(owner, repo, hookId) {
    return this.request('DELETE', `/repos/${owner}/${repo}/hooks/${hookId}`);
  }

  async getAuthenticatedUser() {
    return this.request('GET', '/user');
  }

  async getBranch(owner, repo, branch) {
    try {
      return await this.request('GET', `/repos/${owner}/${repo}/branches/${branch}`);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async deleteBranch(owner, repo, branch) {
    return this.request('DELETE', `/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  }

  async addDeployKey(owner, repo, title, key) {
    return this.request('POST', `/repos/${owner}/${repo}/keys`, {
      title,
      key,
      read_only: false
    });
  }
}

const createGitHubService = (token) => {
  if (!token) {
    throw new Error('GitHub token is required');
  }
  return new GitHubService(token);
};

module.exports = { GitHubService, createGitHubService };