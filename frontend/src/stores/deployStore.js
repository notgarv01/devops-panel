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
  webhookConfigured: false,
  webhookTriggered: false,

  // Progress tracking
  progress: {
    step: 0,
    total: 7,
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

  addLog: (log) => set((state) => {
    // Prevent duplicate consecutive logs
    const lastLog = state.logs[state.logs.length - 1];
    if (lastLog && lastLog.message === log.message && lastLog.level === log.level) {
      return state;
    }
    return {
      logs: [...state.logs, {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
        ...log
      }]
    };
  }),

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
    progress: { step: 0, total: 7, label: '', percentage: 0 },
    webhookConfigured: false
  }),

  setWebhookConfigured: (configured) => set({ webhookConfigured: configured }),

  setWebhookTriggered: (triggered) => set({ webhookTriggered: triggered })
}));

// Socket integration
export const initializeSocketListeners = () => {
  socket.on('connect', () => {
    // Connected silently
  });

  socket.on('disconnect', () => {
    // Disconnected silently
  });

  const handlePipelineLog = (log) => {
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
    const state = useDeployStore.getState();
    if (!state.sessionId || progress.sessionId === state.sessionId) {
      useDeployStore.getState().setProgress(progress);
      // Updated status map for 7-step pipeline
      const statusMap = {
        1: 'scanning',   // Fetching project code
        2: 'analyzing',  // Analyzing project structure
        3: 'transmuting', // Transmuting source code (NEW)
        4: 'transforming', // Generating deployment files
        5: 'pushing',    // Syncing to GitHub
        6: 'webhook',    // Installing webhook
        7: 'deploying'   // Deploying to Vercel
      };
      useDeployStore.getState().setStatus(statusMap[progress.step] || 'transforming');
    }
  };

  socket.on('pipeline-log', handlePipelineLog);
  socket.on('pipeline-progress', handlePipelineProgress);
  socket.on('pipeline-error', (err) => {
    useDeployStore.getState().setError(err.error);
  });

  // Webhook-triggered events
  socket.on('webhook-triggered', (data) => {
    useDeployStore.getState().setWebhookTriggered(true);
    useDeployStore.getState().setSessionId(data.sessionId);
    useDeployStore.getState().setStatus('transmuting');
    useDeployStore.getState().addLog({
      level: 'info',
      message: `Auto-transmutation triggered by webhook from ${data.repo}`
    });
  });

  // Project status updates from orchestrator
  socket.on('project-update', (data) => {
    // This is handled by the ProjectsGrid component via ProjectsGrid's own socket listener
    // Or we can broadcast to a global store
    useDeployStore.getState().addLog({
      level: 'info',
      message: `[Fleet] ${data.projectName} → ${data.status}`
    });
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