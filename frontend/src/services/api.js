import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 120000, // 2 minutes for deployments
});

export const deployService = {
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
};

export default api;