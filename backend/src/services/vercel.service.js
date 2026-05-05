const VERCEL_API = 'https://api.vercel.com';

class VercelService {
  constructor(token) {
    this.token = token;
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  async request(method, endpoint, data = null, timeout = 15000) {
    const url = `${VERCEL_API}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const options = {
      method,
      headers: this.headers,
      signal: controller.signal
    };

    if (data) {
      // Deep clean: remove null/undefined values
      const cleanData = (obj) => {
        if (obj === null || obj === undefined) return undefined;
        if (Array.isArray(obj)) {
          return obj.map(cleanData).filter(v => v !== undefined);
        }
        if (typeof obj === 'object') {
          const result = {};
          for (const key of Object.keys(obj)) {
            const val = cleanData(obj[key]);
            if (val !== undefined) result[key] = val;
          }
          return Object.keys(result).length ? result : undefined;
        }
        return obj;
      };
      const cleaned = cleanData(data);
      if (cleaned) options.body = JSON.stringify(cleaned);
    }

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);
      const json = await response.json();

      if (!response.ok) {
        const error = new Error(json.error?.message || `Vercel API error: ${response.status}`);
        error.status = response.status;
        error.details = json.error;
        throw error;
      }

      return json;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        const error = new Error(`Vercel API timeout (${timeout}ms) for ${method} ${endpoint}`);
        error.status = 408;
        throw error;
      }
      throw err;
    }
  }

  // ===== Project Management =====

  async listProjects() {
    return this.request('GET', '/v9/projects');
  }

  async getProject(projectIdOrName) {
    console.log(`[Vercel] getProject(${projectIdOrName})`);
    try {
      const result = await this.request('GET', `/v9/projects/${projectIdOrName}`);
      console.log(`[Vercel] getProject success:`, result.name);
      return result;
    } catch (error) {
      console.log(`[Vercel] getProject error:`, error.message, 'status:', error.status);
      if (error.status === 404) return null;
      throw error;
    }
  }

  async createProject(projectData) {
    console.log(`[Vercel] createProject:`, JSON.stringify(projectData));
    try {
      const result = await this.request('POST', '/v9/projects', projectData);
      console.log(`[Vercel] createProject success:`, result.id);
      return result;
    } catch (error) {
      console.log(`[Vercel] createProject error:`, error.message, 'status:', error.status, 'details:', JSON.stringify(error.details));
      throw error;
    }
  }

  async updateProject(projectId, updates) {
    return this.request('PATCH', `/v9/projects/${projectId}`, updates);
  }

  async deleteProject(projectId) {
    return this.request('DELETE', `/v9/projects/${projectId}`);
  }

  // ===== Environment Variables =====

  async getEnvVars(projectId) {
    return this.request('GET', `/v10/projects/${projectId}/env`);
  }

  async addEnvVar(projectId, envData) {
    const {
      key,
      value,
      target = 'production',
      type = 'secret',
      gitBranch = null
    } = envData;

    return this.request('POST', `/v10/projects/${projectId}/env`, {
      key,
      value,
      target,
      type,
      ...(gitBranch && { gitBranch })
    });
  }

  async addEnvVarsBatch(projectId, envVars) {
    const results = [];
    const errors = [];

    for (const envVar of envVars) {
      try {
        const result = await this.addEnvVar(projectId, envVar);
        results.push({ key: envVar.key, success: true, id: result.id });
      } catch (error) {
        errors.push({ key: envVar.key, error: error.message });
      }
    }

    return { results, errors };
  }

  async deleteEnvVar(projectId, envId) {
    return this.request('DELETE', `/v10/projects/${projectId}/env/${envId}`);
  }

  // ===== Deployments =====

  async listDeployments(projectId) {
    return this.request('GET', `/v13/deployments?projectId=${projectId}`);
  }

  async getDeployment(deploymentId) {
    return this.request('GET', `/v13/deployments/${deploymentId}`);
  }

  async createDeployment(deploymentData) {
    const {
      name,
      gitSource,
      target = null,
      forceNew = false,
      bypass = false,
      withCache = true,
      env = [],
      buildCommand = null,
      outputDirectory = null,
      rootDirectory = null,
      functions = null,
      regions = null,
      teamId = null
    } = deploymentData;

    const body = {
      name
    };

    // Handle gitSource - Vercel v13 prefers repoId over repo string
    if (gitSource) {
      const gs = { type: gitSource.type || 'github' };
      if (gitSource.repoId) {
        gs.repoId = gitSource.repoId;
      }
      if (gitSource.ref) {
        gs.ref = gitSource.ref;
      }
      if (!gitSource.repoId && gitSource.repo) {
        gs.repo = gitSource.repo;
      }
      body.gitSource = gs;
    }

    const endpoint = teamId ? `/v13/deployments?teamId=${teamId}` : '/v13/deployments';
    console.log(`[Vercel] POST ${endpoint} body:`, JSON.stringify(body).substring(0, 300));
    return this.request('POST', endpoint, body);
  }

  async redeploy(projectId, deploymentId) {
    const deployment = await this.getDeployment(deploymentId);
    const { url, ...rest } = deployment;

    // Extract project name from URL
    const projectName = url.split('.')[0].replace('https://', '');

    return this.createDeployment({
      name: projectName,
      gitSource: rest.gitSource,
      target: rest.target || null,
      forceNew: true
    });
  }

  async cancelDeployment(deploymentId) {
    return this.request('POST', `/v13/deployments/${deploymentId}/cancel`);
  }

  async getDeploymentLogs(deploymentId) {
    return this.request('GET', `/v2/deployments/${deploymentId}/events`);
  }

  // ===== Team/Account =====

  async getUser() {
    return this.request('GET', '/v2/user');
  }

  async getTeams() {
    return this.request('GET', '/v2/teams');
  }

  async getTeam(teamId) {
    return this.request('GET', `/v2/teams/${teamId}`);
  }

  // ===== Domain Management =====

  async addDomain(projectId, domain) {
    return this.request('POST', `/v9/projects/${projectId}/domains`, {
      name: domain
    });
  }

  async verifyDomain(projectId, domain) {
    return this.request('POST', `/v9/projects/${projectId}/domains/${domain}/verify`);
  }

  async listDomains(projectId) {
    return this.request('GET', `/v9/projects/${projectId}/domains`);
  }

  async deleteDomain(projectId, domain) {
    return this.request('DELETE', `/v9/projects/${projectId}/domains/${domain}`);
  }

  // ===== Secrets =====

  async listSecrets(teamId = null) {
    const endpoint = teamId ? `/v2/secrets?teamId=${teamId}` : '/v2/secrets';
    return this.request('GET', endpoint);
  }

  async createSecret(name, value) {
    return this.request('POST', '/v2/secrets', {
      name,
      value
    });
  }

  async deleteSecret(name) {
    return this.request('DELETE', `/v2/secrets/${name}`);
  }
}

const createVercelService = (token) => {
  if (!token) {
    throw new Error('Vercel token is required');
  }
  return new VercelService(token);
};

module.exports = { VercelService, createVercelService };