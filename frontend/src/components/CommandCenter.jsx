import { useEffect, useState, useCallback } from 'react';
import {
  Rocket,
  FolderOpen,
  Key,
  Terminal,
  CheckCircle2,
  XCircle,
  ExternalLink,
  FileCode,
  Zap,
  Loader2,
  RotateCcw,
  Eye,
  Copy,
  Shield,
  Github,
  Link
} from 'lucide-react';
import { useDeployStore, initializeSocketListeners } from '../stores/deployStore';
import EnvManager from './EnvManager';
import StatusBadge from './StatusBadge';

export default function CommandCenter() {
  const {
    status,
    logs,
    sessionId,
    projectData,
    deployResult,
    error,
    progress,
    githubToken,
    vercelToken,
    setTokens,
    setProjectData,
    runPipeline,
    analyzeProject,
    reset
  } = useDeployStore();

  const [repoUrl, setRepoUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [branch, setBranch] = useState('auto');
  const [envVars, setEnvVars] = useState([{ key: '', value: '' }]);
  const [showVercelConfig, setShowVercelConfig] = useState(false);
  const [inputMode, setInputMode] = useState('url'); // 'url' or 'folder'

  useEffect(() => {
    initializeSocketListeners();
  }, []);

  const extractRepoName = (url) => {
    if (!url) return '';
    const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
    return match ? match[1] : '';
  };

  useEffect(() => {
    if (repoUrl) {
      const name = extractRepoName(repoUrl);
      if (name) setProjectName(name.toLowerCase().replace(/[^a-z0-9]/g, '-'));
    }
  }, [repoUrl]);

  const handleDeploy = async () => {
    if (!repoUrl) return;

    setProjectData({
      path: repoUrl,
      type: 'auto',
      confidence: 0.9,
      signals: ['github'],
      directories: [],
      files: []
    });

    try {
      const result = await runPipeline({
        projectPath: repoUrl,
        projectName: projectName || extractRepoName(repoUrl),
        branch: branch === 'auto' ? null : branch,
        githubToken,
        vercelToken: vercelToken || undefined,
        envVars: envVars.filter(e => e.key && e.value)
      });
    } catch (err) {
      console.error('Deploy failed:', err);
    }
  };

  const handleReset = () => {
    reset();
    setRepoUrl('');
    setProjectName('');
    setEnvVars([{ key: '', value: '' }]);
  };

  const isRunning = ['analyzing', 'transforming', 'pushing', 'deploying'].includes(status);
  const isComplete = status === 'live' && deployResult;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ===== ZONE A: INPUT DECK ===== */}
        <div className="lg:col-span-1 space-y-6">
          {/* Header Card */}
          <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-xl bg-blue-500/20">
                <Rocket className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Command Center</h2>
                <p className="text-xs text-zinc-500">Transform & Deploy Pipeline</p>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between mb-4">
              <StatusBadge status={status} size="md" />
              {sessionId && (
                <span className="text-xs text-zinc-600 font-mono">
                  {sessionId.substring(0, 16)}...
                </span>
              )}
            </div>

            {/* Progress Bar */}
            {progress.percentage > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>{progress.label || 'Processing...'}</span>
                  <span>{progress.percentage}%</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* GitHub Repository URL */}
          <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Github className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-400">GitHub Repository</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                  <Link className="w-3 h-3" />
                  Repository URL
                </label>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/username/repo"
                  disabled={isRunning}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Project Name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="my-awesome-project"
                  disabled={isRunning}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <p className="text-xs text-zinc-600 mt-1">This will be your Vercel project URL</p>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Branch</label>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="auto">Auto-detect</option>
                  <option value="main">main</option>
                  <option value="master">master</option>
                  <option value="dev">dev</option>
                </select>
                <p className="text-xs text-zinc-600 mt-1">Leave auto-detect for default branch</p>
              </div>
            </div>
          </div>

          {/* Tokens */}
          <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-400">API Tokens</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">GitHub Token</label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setTokens(e.target.value, vercelToken)}
                  placeholder="ghp_xxxxxxxxxxxx"
                  disabled={isRunning}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <p className="text-xs text-zinc-600 mt-1">Required for repo creation</p>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Vercel Token</label>
                <input
                  type="password"
                  value={vercelToken}
                  onChange={(e) => setTokens(githubToken, e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxx"
                  disabled={isRunning}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <p className="text-xs text-zinc-600 mt-1">Optional - auto-deploy to Vercel</p>
              </div>
            </div>
          </div>

          {/* Environment Variables */}
          <EnvManager envVars={envVars} onChange={setEnvVars} readOnly={isRunning} />

          {/* Deploy Button */}
          <button
            onClick={handleDeploy}
            disabled={!repoUrl || !githubToken || !projectName || isRunning}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {status === 'analyzing' ? 'Analyzing...' :
                 status === 'transforming' ? 'Transforming...' :
                 status === 'pushing' ? 'Pushing to GitHub...' :
                 status === 'deploying' ? 'Deploying to Vercel...' : 'Processing...'}
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5" />
                Transform & Deploy
              </>
            )}
          </button>

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2 text-red-400 mb-2">
                <XCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Error</span>
              </div>
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
        </div>

        {/* ===== ZONE B: TRANSFORMATION FEED ===== */}
        <div className="lg:col-span-1">
          <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl h-full flex flex-col">
            {/* Terminal Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-medium text-zinc-400">Transformation Feed</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => useDeployStore.getState().clearLogs()}
                  className="text-xs text-zinc-600 hover:text-zinc-400"
                >
                  Clear
                </button>
                <div className={`w-2 h-2 rounded-full ${status === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
              </div>
            </div>

            {/* Terminal Output */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-sm bg-[#050505] min-h-[500px]">
              {logs.length > 0 ? (
                <div className="space-y-1.5">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`
                        flex items-start gap-2 text-xs leading-relaxed
                        ${log.level === 'success' ? 'text-emerald-400' :
                          log.level === 'error' ? 'text-red-400' :
                          log.level === 'warning' ? 'text-amber-400' :
                          'text-zinc-300'}
                      `}
                    >
                      <span className="text-zinc-600 w-16 flex-shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="w-4 text-center flex-shrink-0">
                        {log.level === 'success' ? '✓' :
                         log.level === 'error' ? '✗' :
                         log.level === 'warning' ? '⚠' : '›'}
                      </span>
                      <span className="whitespace-pre-wrap break-all">{log.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-700">
                  <Terminal className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">Waiting for input...</p>
                  <p className="text-xs text-zinc-800 mt-1">Logs will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== ZONE C: RESULT CARD ===== */}
        <div className="lg:col-span-1">
          {isComplete ? (
            <div className="bg-[#0F0F0F] border border-emerald-500/30 rounded-2xl p-6 space-y-6">
              {/* Success Header */}
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-white">Live!</h3>
                <p className="text-sm text-zinc-500">Deployment complete</p>
              </div>

              {/* Live Indicator */}
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <div className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 font-medium">Production Ready</span>
                </div>
              </div>

              {/* Links */}
              <div className="space-y-3">
                {deployResult?.repository && (
                  <a
                    href={deployResult.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-zinc-400" />
                      <span className="text-sm text-zinc-300">Repository</span>
                    </div>
                    <ExternalLink className="w-4 h-4 text-zinc-500" />
                  </a>
                )}

                {deployResult?.deployment && (
                  <a
                    href={deployResult.deployment}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-emerald-500/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-400">Live Site</span>
                    </div>
                    <ExternalLink className="w-4 h-4 text-zinc-500" />
                  </a>
                )}
              </div>

              {/* Generated Config */}
              <div>
                <button
                  onClick={() => setShowVercelConfig(!showVercelConfig)}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm text-zinc-300">Generated Config</span>
                  </div>
                  <Eye className="w-4 h-4 text-zinc-500" />
                </button>

                {showVercelConfig && (
                  <div className="mt-2 p-3 rounded-lg bg-black border border-zinc-800">
                    <pre className="text-xs text-emerald-400 font-mono overflow-x-auto">
{`{
  "version": 2,
  "builds": [
    { "src": "api/**/*.js", "use": "@vercel/node" }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}`}
                    </pre>
                  </div>
                )}
              </div>

              {/* Reset Button */}
              <button
                onClick={handleReset}
                className="w-full py-3 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Deploy Another
              </button>
            </div>
          ) : (
            <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl p-6 h-full flex flex-col">
              <div className="text-center text-zinc-700 flex-1 flex flex-col items-center justify-center">
                <Rocket className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm text-zinc-500 mb-2">Ready to Deploy</p>
                <p className="text-xs text-zinc-600">
                  Enter a GitHub repo URL to begin
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}