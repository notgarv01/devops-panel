import { create } from 'zustand';
import { deployService } from '../services/api';
import socket from '../services/socket';

export const useDeployStore = create((set, get) => ({
  // State
  status: 'idle',
  logs: [],
  sessionId: null,
  projectData: null,
  deployResult: null,
  error: null,

  // Progress tracking
  progress: {
    step: 0,
    total: 4,
    label: '',
    percentage: 0
  },

  // Token state
  githubToken: '',
  vercelToken: '',

  // Actions
  setStatus: (status) => set({ status }),

  setProjectData: (data) => set({ projectData: data }),

  setTokens: (githubToken, vercelToken) => set({ githubToken, vercelToken }),

  addLog: (log) => set((state) => ({
    logs: [...state.logs, {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      ...log
    }]
  })),

  clearLogs: () => set({ logs: [] }),

  setProgress: (progress) => set({ progress }),

  setError: (error) => set({ error, status: 'error' }),

  clearError: () => set({ error: null }),

  setDeployResult: (result) => set({
    deployResult: result,
    status: 'live'
  }),

  setSessionId: (sessionId) => {
    set({ sessionId });
    // Join the socket room for this pipeline session
    socket.emit('join-pipeline', sessionId);
  },

  // Full pipeline trigger
  runPipeline: async (config) => {
    const { projectPath, projectName, envVars = [], githubToken, vercelToken } = config;

    // Generate session ID BEFORE making the request
    const newSessionId = `pipeline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    set({
      status: 'analyzing',
      logs: [],
      error: null,
      deployResult: null,
      sessionId: newSessionId
    });

    get().addLog({ level: 'info', message: 'Initializing pipeline...' });
    get().addLog({ level: 'info', message: `Project: ${projectName}` });

    try {
      // Join socket room FIRST with our session ID
      socket.emit('join-pipeline', newSessionId);
      console.log('[Socket] Joined room:', newSessionId);

      // Call API with our session ID
      const result = await deployService.runPipeline({
        projectPath,
        projectName,
        githubToken,
        vercelToken,
        envVars,
        sessionId: newSessionId, // Send sessionId to backend
        options: {
          webhookUrl: `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/webhooks/github`
        }
      });

      console.log('[Pipeline] Started:', result.sessionId);
      get().addLog({ level: 'success', message: `Pipeline started: ${result.sessionId}` });

      return result;
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message;
      get().setError(errorMsg);
      get().addLog({ level: 'error', message: errorMsg });
      throw error;
    }
  },

  // Analyze only
  analyzeProject: async (projectPath) => {
    set({ status: 'scanning', projectData: null });
    get().addLog({ level: 'info', message: 'Scanning project...' });

    try {
      const result = await deployService.analyzeProject(projectPath);

      get().setProjectData({
        path: projectPath,
        type: result.analysis?.projectType?.type || 'UNKNOWN',
        confidence: result.analysis?.projectType?.confidence || 0,
        signals: result.analysis?.projectType?.signals || [],
        files: result.analysis?.structure?.files || [],
        directories: result.analysis?.structure?.directories || []
      });

      get().addLog({
        level: 'success',
        message: `Detected: ${result.analysis?.projectType?.type} (${Math.round((result.analysis?.projectType?.confidence || 0) * 100)}%)`
      });

      set({ status: 'idle' });
      return result;
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message;
      get().setError(errorMsg);
      set({ status: 'error' });
      throw error;
    }
  },

  // Reset everything
  reset: () => set({
    status: 'idle',
    logs: [],
    sessionId: null,
    projectData: null,
    deployResult: null,
    error: null,
    progress: { step: 0, total: 4, label: '', percentage: 0 }
  })
}));

// Socket integration
export const initializeSocketListeners = () => {
  console.log('[Socket] Initializing listeners, socket id:', socket.id);

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected');
  });

  const handlePipelineLog = (log) => {
    console.log('[Socket] pipeline-log received:', log);
    const state = useDeployStore.getState();
    // Match by sessionId if present, otherwise show all logs
    if (!state.sessionId || log.sessionId === state.sessionId) {
      useDeployStore.getState().addLog({
        level: log.level,
        message: log.message
      });
    }
  };

  const handlePipelineProgress = (progress) => {
    console.log('[Socket] pipeline-progress received:', progress);
    const state = useDeployStore.getState();
    if (!state.sessionId || progress.sessionId === state.sessionId) {
      useDeployStore.getState().setProgress(progress);
      const statusMap = { 1: 'analyzing', 2: 'transforming', 3: 'pushing', 4: 'deploying' };
      useDeployStore.getState().setStatus(statusMap[progress.step] || 'transforming');
    }
  };

  socket.on('pipeline-log', handlePipelineLog);
  socket.on('pipeline-progress', handlePipelineProgress);
  socket.on('pipeline-error', (err) => {
    console.log('[Socket] pipeline-error received:', err);
    useDeployStore.getState().setError(err.error);
  });

  return () => {
    socket.off('pipeline-log', handlePipelineLog);
    socket.off('pipeline-progress', handlePipelineProgress);
    socket.off('pipeline-error');
    socket.off('connect');
    socket.off('disconnect');
  };
};

export default useDeployStore;