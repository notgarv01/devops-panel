import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 120000,
});

export const deployService = {
  // Existing deployment methods
  createDeployment: async (data) => {
    const response = await api.post('/deploy', data);
    return response.data;
  },

  getDeployments: async () => {
    const response = await api.get('/deploy');
    return response.data;
  },

  getDeployment: async (id) => {
    const response = await api.get(`/deploy/${id}`);
    return response.data;
  },

  stopDeployment: async (id) => {
    const response = await api.post(`/deploy/${id}/stop`);
    return response.data;
  },

  deleteDeployment: async (id) => {
    const response = await api.delete(`/deploy/${id}`);
    return response.data;
  },

  restartDeployment: async (id) => {
    const response = await api.post(`/deploy/${id}/restart`);
    return response.data;
  },

  // Intake / Analysis
  analyzeProject: async (projectPath) => {
    const response = await api.post('/intake/intake', { projectPath });
    return response.data;
  },

  // Pipeline (full orchestration)
  runPipeline: async (data) => {
    const response = await api.post('/pipeline/run', data);
    return response.data;
  },

  // Transform
  transformProject: async (workDir, projectType, options = {}) => {
    const response = await api.post('/transform/transform', { workDir, projectType, options });
    return response.data;
  },

  previewVercel: async (projectType, config = {}) => {
    const response = await api.post('/transform/preview-vercel', { projectType, config });
    return response.data;
  },

  // Ship (GitHub sync)
  deployToShip: async (data) => {
    const response = await api.post('/ship/deploy', data);
    return response.data;
  },

  verifyGitHubToken: async (token) => {
    const response = await api.post('/ship/verify-token', { token });
    return response.data;
  },

  // Vercel
  deployToVercel: async (data) => {
    const response = await api.post('/vercel/deploy', data);
    return response.data;
  },

  verifyVercelToken: async (token) => {
    const response = await api.post('/vercel/verify-token', { token });
    return response.data;
  },

  getVercelProjects: async (token) => {
    const response = await api.get('/vercel/projects', { params: { vercelToken: token } });
    return response.data;
  },

  getVercelDeployment: async (token, id) => {
    const response = await api.get(`/vercel/deployment/${id}`, { params: { vercelToken: token } });
    return response.data;
  },
};

export default api;