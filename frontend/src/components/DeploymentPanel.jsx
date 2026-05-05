import { useState, useEffect } from 'react';
import {
  Rocket,
  Github,
  Cloud,
  ChevronRight,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Zap,
  Settings
} from 'lucide-react';
import ProjectScanner from './ProjectScanner';
import EnvManager from './EnvManager';
import DeploymentTerminal from './DeploymentTerminal';
import StatusBadge from './StatusBadge';
import { deployService } from '../services/api';

const VIEWS = {
  SCANNER: 'scanner',
  CONFIG: 'config',
  DEPLOY: 'deploy',
  SUCCESS: 'success'
};

export default function DeploymentPanel() {
  const [currentView, setCurrentView] = useState(VIEWS.SCANNER);
  const [projectData, setProjectData] = useState(null);
  const [envVars, setEnvVars] = useState([{ key: '', value: '', type: 'secret' }]);
  const [projectName, setProjectName] = useState('');
  const [repoName, setRepoName] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [vercelToken, setVercelToken] = useState('');
  const [autoGenerateConfig, setAutoGenerateConfig] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(0);
  const [deployResult, setDeployResult] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [vercelJsonPreview, setVercelJsonPreview] = useState(null);
  const [error, setError] = useState(null);

  const handleProjectDetected = (data) => {
    setProjectData(data);
    setProjectName(data.path.split(/[/\\]/).pop());
    setRepoName(data.path.split(/[/\\]/).pop().toLowerCase().replace(/[^a-z0-9]/g, '-'));
    setCurrentView(VIEWS.CONFIG);
  };

  const handleConfigNext = async () => {
    if (autoGenerateConfig && projectData) {
      try {
        const preview = await deployService.previewVercel(projectData.type);
        setVercelJsonPreview(preview.raw);
      } catch (err) {
        console.error('Failed to preview vercel config:', err);
      }
    }
    setCurrentView(VIEWS.DEPLOY);
  };

  const handleDeploy = async () => {
    if (!githubToken) {
      setError('GitHub token is required');
      return;
    }

    setIsDeploying(true);
    setDeployProgress(0);
    setError(null);
    setSessionId(null);

    try {
      // Start the full pipeline
      const result = await deployService.deployToShip({
        githubToken,
        repoName,
        projectPath: projectData.path,
        branch: 'main',
        projectType: projectData.type,
        options: {
          webhookUrl: `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/webhooks/github`,
          private: true
        }
      });

      setSessionId(result.sessionId);
      setDeployProgress(25);

      // If Vercel token provided, trigger Vercel deployment after GitHub sync
      if (vercelToken) {
        // Wait for GitHub sync to complete (check for session logs)
        const checkVercel = setInterval(async () => {
          // In real implementation, listen for ship-log completion events
        }, 2000);

        // Trigger Vercel deployment
        await deployService.deployToVercel({
          vercelToken,
          githubToken,
          repoOwner: 'current-user',
          repoName,
          branch: 'main',
          projectName,
          projectType: projectData.type,
          envVars: envVars.filter(e => e.key && e.value)
        });

        clearInterval(checkVercel);
      }

      setDeployProgress(100);
      setDeployResult({
        repoUrl: `https://github.com/.../${repoName}`,
        vercelUrl: vercelToken ? `https://${projectName}.vercel.app` : null,
        projectName
      });
      setCurrentView(VIEWS.SUCCESS);

    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Deployment failed');
      setIsDeploying(false);
    }
  };

  const resetPanel = () => {
    setProjectData(null);
    setProjectName('');
    setRepoName('');
    setEnvVars([{ key: '', value: '', type: 'secret' }]);
    setDeployResult(null);
    setSessionId(null);
    setVercelJsonPreview(null);
    setCurrentView(VIEWS.SCANNER);
    setIsDeploying(false);
    setDeployProgress(0);
  };

  return (
    <div className="max-w-2xl mx-auto mt-8">
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {['Scan', 'Configure', 'Deploy'].map((step, i) => {
          const stepKey = Object.values(VIEWS)[i];
          const isActive = currentView === stepKey || (i === 2 && currentView === VIEWS.SUCCESS);
          const isComplete = i < Object.values(VIEWS).indexOf(currentView) || currentView === VIEWS.SUCCESS;

          return (
            <div key={step} className="flex items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${isComplete ? 'bg-emerald-500 text-white' : isActive ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-500'}
                transition-all duration-300
              `}>
                {isComplete ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
              </div>
              <span className={`ml-2 text-sm ${isActive || isComplete ? 'text-white' : 'text-zinc-600'}`}>
                {step}
              </span>
              {i < 2 && (
                <ChevronRight className={`w-4 h-4 mx-2 ${isComplete ? 'text-emerald-500' : 'text-zinc-700'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Deployment Card */}
      <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 bg-gradient-to-r from-zinc-900/50 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20">
                <Rocket className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Deploy Project</h2>
                <p className="text-sm text-zinc-500">
                  {currentView === VIEWS.SCANNER && 'Start by scanning your project'}
                  {currentView === VIEWS.CONFIG && 'Configure your deployment settings'}
                  {currentView === VIEWS.DEPLOY && 'Transform and deploy to Vercel'}
                  {currentView === VIEWS.SUCCESS && 'Deployment complete!'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {projectData && (
                <StatusBadge status={isDeploying ? 'deploying' : 'pending'} size="sm" />
              )}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {(isDeploying || currentView === VIEWS.DEPLOY) && (
          <div className="h-1 bg-zinc-900">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${deployProgress}%` }}
            />
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* VIEW A: Project Scanner */}
          {currentView === VIEWS.SCANNER && (
            <ProjectScanner onProjectDetected={handleProjectDetected} onError={setError} />
          )}

          {/* VIEW B: Configuration Bridge */}
          {currentView === VIEWS.CONFIG && projectData && (
            <div className="space-y-6">
              {/* Detected Type */}
              <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-500 mb-1">Detected Project Type</p>
                    <p className="text-lg font-semibold text-blue-400">
                      {projectData.type?.replace('_', ' ')}
                      <span className="text-xs text-zinc-500 ml-2">
                        ({Math.round((projectData.confidence || 0.9) * 100)}%)
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => setCurrentView(VIEWS.SCANNER)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Rescan
                  </button>
                </div>
              </div>

              {/* Project & Repo Settings */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Deployment Settings
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5">Project Name</label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5">Repository Name</label>
                    <input
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Tokens */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                      <Github className="w-3 h-3" />
                      GitHub Token
                    </label>
                    <input
                      type="password"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxx"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                      <Cloud className="w-3 h-3" />
                      Vercel Token (optional)
                    </label>
                    <input
                      type="password"
                      value={vercelToken}
                      onChange={(e) => setVercelToken(e.target.value)}
                      placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Vercel-ify Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/20">
                      <Zap className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Auto-generate Deployment Config</p>
                      <p className="text-xs text-zinc-500">Create vercel.json and transform code</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setAutoGenerateConfig(!autoGenerateConfig)}
                    className={`
                      relative w-12 h-6 rounded-full transition-colors
                      ${autoGenerateConfig ? 'bg-emerald-500' : 'bg-zinc-700'}
                    `}
                  >
                    <span className={`
                      absolute top-1 w-4 h-4 bg-white rounded-full transition-transform
                      ${autoGenerateConfig ? 'left-7' : 'left-1'}
                    `} />
                  </button>
                </div>
              </div>

              {/* Environment Variables */}
              <EnvManager envVars={envVars} onChange={setEnvVars} />

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentView(VIEWS.SCANNER)}
                  className="flex-1 py-3 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfigNext}
                  className="flex-1 py-3 rounded-lg bg-white text-black font-medium hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* VIEW C: Deployment Console */}
          {currentView === VIEWS.DEPLOY && (
            <div className="space-y-6">
              {/* Vercel.json Preview */}
              {vercelJsonPreview && (
                <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                  <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Generated vercel.json
                  </p>
                  <pre className="text-xs text-emerald-400 font-mono bg-black/50 p-3 rounded-lg overflow-x-auto">
                    {vercelJsonPreview}
                  </pre>
                </div>
              )}

              {/* Terminal */}
              <DeploymentTerminal
                sessionId={sessionId}
                title={`Deploying: ${projectName}`}
              />

              {/* Error */}
              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Deploy Button */}
              {!sessionId && !isDeploying && (
                <button
                  onClick={handleDeploy}
                  disabled={!githubToken}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Rocket className="w-5 h-5" />
                  Transform & Deploy
                </button>
              )}

              {isDeploying && !sessionId && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                  <span className="text-zinc-400">Initializing deployment...</span>
                </div>
              )}
            </div>
          )}

          {/* VIEW D: Success / Magic Moment */}
          {currentView === VIEWS.SUCCESS && deployResult && (
            <div className="space-y-6">
              {/* Success Header */}
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Deployment Complete!</h3>
                <p className="text-zinc-500">Your project is now live</p>
              </div>

              {/* Live Preview */}
              <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-black">
                <div className="absolute top-0 left-0 right-0 h-8 bg-zinc-900 flex items-center px-3 gap-2 z-10">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-auto text-xs text-zinc-600">{projectName}.vercel.app</span>
                </div>
                <div className="h-64 bg-gradient-to-br from-zinc-800 to-zinc-900 mt-8 flex items-center justify-center">
                  <p className="text-zinc-600 text-sm">Live preview loading...</p>
                </div>
              </div>

              {/* Links */}
              <div className="grid grid-cols-2 gap-3">
                <a
                  href={deployResult.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <Github className="w-5 h-5" />
                  <span className="text-sm">View Repository</span>
                  <ExternalLink className="w-4 h-4 text-zinc-500" />
                </a>
                {deployResult.vercelUrl && (
                  <a
                    href={deployResult.vercelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <Cloud className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm">View Live Site</span>
                    <ExternalLink className="w-4 h-4 text-zinc-500" />
                  </a>
                )}
              </div>

              {/* Deploy Another */}
              <button
                onClick={resetPanel}
                className="w-full py-3 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
              >
                Deploy Another Project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}