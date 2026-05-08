import { useEffect, useState, useRef } from 'react';
import {
  Key,
  Terminal,
  CheckCircle2,
  XCircle,
  ExternalLink,
  FileCode,
  Zap,
  RotateCcw,
  Eye,
  EyeOff,
  Shield,
  Github,
  Link,
  Check,
  Database,
  Plus,
  Trash2,
  Rocket,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { useDeployStore, initializeSocketListeners } from '../stores/deployStore';
import StatusBadge from './StatusBadge';
import CommandBar from './CommandBar';

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
    reset
  } = useDeployStore();

  const [repoUrl, setRepoUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [envVars, setEnvVars] = useState([{ key: '', value: '' }]);
  const [deployMode, setDeployMode] = useState('fast'); // 'fast' or 'slow'
  const [showVercelToken, setShowVercelToken] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showEnvValues, setShowEnvValues] = useState(false);
  const [bulkEnvText, setBulkEnvText] = useState('');

  // Verification states
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [isUrlVerified, setIsUrlVerified] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);

  const verifyTimeoutRef = useRef(null);

  useEffect(() => {
    initializeSocketListeners();
  }, []);

  const extractRepoName = (url) => {
    if (!url) return '';
    const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
    return match ? match[1] : '';
  };

  // URL validation and verification
  useEffect(() => {
    const githubRegex = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/;

    if (repoUrl) {
      const isValid = githubRegex.test(repoUrl);
      setIsUrlValid(isValid);
      setIsUrlVerified(false);

      // Clear previous timeout
      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current);
      }

      if (isValid) {
        // Simulate verification delay
        verifyTimeoutRef.current = setTimeout(() => {
          setIsUrlVerified(true);
          setShowTokenInput(true);
          // Auto-extract project name
          const name = extractRepoName(repoUrl);
          if (name && !projectName) {
            setProjectName(name.toLowerCase().replace(/[^a-z0-9]/g, '-'));
          }
        }, 800);
      } else {
        setShowTokenInput(false);
      }
    } else {
      setIsUrlValid(false);
      setIsUrlVerified(false);
      setShowTokenInput(false);
    }

    return () => {
      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current);
      }
    };
  }, [repoUrl]);

  // Handle ENV key suggestions
  const getEnvSuggestion = (key) => {
    const suggestions = {
      'API_URL': 'VITE_API_URL',
      'BASE_URL': 'VITE_BASE_URL',
      'KEY': 'VITE_API_KEY',
      'SECRET': 'VITE_SECRET',
      'TOKEN': 'VITE_TOKEN',
      'URL': 'VITE_URL',
      'DATABASE_URL': 'VITE_DATABASE_URL',
      'STRIPE': 'VITE_STRIPE_KEY',
    };
    return suggestions[key.toUpperCase()] || null;
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleRemoveEnv = (index) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleEnvChange = (index, field, value) => {
    const updated = [...envVars];
    updated[index][field] = field === 'key' ? value.toUpperCase() : value;
    setEnvVars(updated);
  };

  const handleBulkEnvChange = (text) => {
    setBulkEnvText(text);
    parseBulkEnvText(text);
  };

  const handleBulkEnvPaste = (text) => {
    setBulkEnvText(text);
    parseBulkEnvText(text);
  };

  const parseBulkEnvText = (text) => {
    if (!text.trim()) return;
    const lines = text.split('\n').filter(line => line.includes('='));
    const parsed = lines.map(line => {
      const eqIndex = line.indexOf('=');
      return {
        key: line.substring(0, eqIndex).trim().toUpperCase(),
        value: line.substring(eqIndex + 1).trim()
      };
    }).filter(p => p.key);

    if (parsed.length > 0) {
      const currentFilled = envVars.filter(e => e.key && e.value);
      const newOnes = parsed.filter(p => !currentFilled.some(c => c.key === p.key));
      setEnvVars([...currentFilled, ...newOnes]);
      setBulkEnvText('');
    }
  };

  const handleDeploy = async () => {
    if (!repoUrl || !githubToken) return;

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
        githubToken,
        vercelToken: deployMode === 'slow' ? vercelToken : undefined,
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
    setBulkEnvText('');
    setDeployMode('fast');
    setShowTokenInput(false);
  };

  const isRunning = ['analyzing', 'transforming', 'pushing', 'deploying'].includes(status);
  const isComplete = status === 'live' && deployResult;

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 h-screen flex flex-col">
        {/* ===== MAIN CONTENT - HORIZONTAL LAYOUT ===== */}
        <div className="flex-1 flex gap-6 p-6 overflow-hidden">
          {/* ===== LEFT: INPUT CARD (30%) ===== */}
          <div className="w-[30%] glass-card rounded-2xl p-6 flex flex-col overflow-y-auto">
            {/* Status Bar */}
            <div className="flex items-center justify-between mb-4">
              <StatusBadge status={status} size="md" />
              {sessionId && (
                <span className="text-xs text-zinc-600 font-mono">
                  {sessionId.substring(0, 12)}...
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
                <div className="h-1 bg-zinc-800/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-400 to-purple-500 transition-all duration-500"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
              </div>
            )}

            {/* ===== REPOSITORY INPUT ===== */}
            <div className="mb-4">
              <label className="block text-xs text-zinc-500 mb-2 flex items-center gap-2">
                <Github className="w-3.5 h-3.5" />
                GitHub Repository
              </label>

              <div className="relative">
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/username/repo"
                  disabled={isRunning}
                  className="w-full bg-zinc-900/50 border border-zinc-800/50 rounded-xl px-4 py-3 pr-12 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:bg-zinc-900/70 transition-all disabled:opacity-50"
                />

                {/* Verification Indicator */}
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  {isUrlVerified ? (
                    <div className="flex items-center gap-1.5 animate-check-pop">
                      <Check className="w-4 h-4 text-emerald-400" />
                    </div>
                  ) : isUrlValid ? (
                    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse-dot" />
                  ) : repoUrl ? (
                    <div className="w-2 h-2 rounded-full bg-zinc-600" />
                  ) : null}
                </div>
              </div>
            </div>

            {/* Project Name - Always visible */}
            <div className="mb-4">
              <label className="block text-xs text-zinc-500 mb-2 flex items-center gap-2">
                <Link className="w-3.5 h-3.5" />
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-project"
                disabled={isRunning}
                className="w-full bg-zinc-900/50 border border-zinc-800/50 rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors disabled:opacity-50"
              />
            </div>

            {/* GitHub Token */}
            <div className="mb-4">
              <label className="block text-xs text-zinc-500 mb-2 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" />
                GitHub Token
              </label>
              <div className="relative">
                <input
                  type={showGithubToken ? 'text' : 'password'}
                  value={githubToken}
                  onChange={(e) => setTokens(e.target.value, vercelToken)}
                  placeholder="ghp_xxxxxxxx"
                  disabled={isRunning}
                  className="w-full bg-zinc-900/50 border border-zinc-800/50 rounded-xl px-4 py-3 pr-10 text-white text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                />
                <button
                  onClick={() => setShowGithubToken(!showGithubToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showGithubToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Vercel Token - Only for Slow Deploy */}
            {deployMode === 'slow' && (
              <div className="mb-4">
                <label className="block text-xs text-zinc-500 mb-2 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
                  Vercel Token
                </label>
                <div className="relative">
                  <input
                    type={showVercelToken ? 'text' : 'password'}
                    value={vercelToken}
                    onChange={(e) => setTokens(githubToken, e.target.value)}
                    placeholder="Vercel API Token"
                    disabled={isRunning}
                    className="w-full bg-zinc-900/50 border border-purple-500/30 rounded-xl px-4 py-3 pr-10 text-white text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-purple-500/60 transition-colors disabled:opacity-50"
                  />
                  <button
                    onClick={() => setShowVercelToken(!showVercelToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showVercelToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Deploy Mode */}
            <div className="mb-4">
              <label className="block text-xs text-zinc-500 mb-3">Deploy Mode</label>
              <div className="grid grid-cols-2 gap-3">
                {/* Fast Deploy */}
                <button
                  onClick={() => setDeployMode('fast')}
                  disabled={isRunning}
                  className={`
                    mode-card p-4 rounded-xl border text-left transition-all
                    ${deployMode === 'fast'
                      ? 'selected-cyan border-cyan-500/40'
                      : 'bg-zinc-900/30 border-zinc-800/30 hover:border-zinc-700/50'}
                    ${isRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${deployMode === 'fast' ? 'bg-cyan-500/20' : 'bg-zinc-800/50'}`}>
                      <Zap className={`w-5 h-5 ${deployMode === 'fast' ? 'text-cyan-400 animate-lightning' : 'text-zinc-500'}`} />
                    </div>
                    <div>
                      <h4 className={`text-sm font-semibold ${deployMode === 'fast' ? 'text-cyan-400' : 'text-white'}`}>
                        Fast
                      </h4>
                      <p className="text-[10px] text-zinc-600">Sandbox</p>
                    </div>
                  </div>
                </button>

                {/* Slow Deploy */}
                <button
                  onClick={() => setDeployMode('slow')}
                  disabled={isRunning}
                  className={`
                    mode-card p-4 rounded-xl border text-left transition-all
                    ${deployMode === 'slow'
                      ? 'selected-purple border-purple-500/40'
                      : 'bg-zinc-900/30 border-zinc-800/30 hover:border-zinc-700/50'}
                    ${isRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${deployMode === 'slow' ? 'bg-purple-500/20' : 'bg-zinc-800/50'}`}>
                      <Database className={`w-5 h-5 ${deployMode === 'slow' ? 'text-purple-400 animate-sync' : 'text-zinc-500'}`} />
                    </div>
                    <div>
                      <h4 className={`text-sm font-semibold ${deployMode === 'slow' ? 'text-purple-400' : 'text-white'}`}>
                        Slow
                      </h4>
                      <p className="text-[10px] text-zinc-600">Production</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* ===== ENV VARS ===== */}
            {showTokenInput && (
              <div className="mt-4 animate-slide-up">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-xs font-medium text-white">ENV</span>
                    <span className="text-[10px] text-zinc-600">({envVars.filter(e => e.key).length})</span>
                  </div>
                  <button
                    onClick={() => setShowEnvValues(!showEnvValues)}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showEnvValues ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>

                {/* Bulk Paste Area */}
                <div className="mb-3">
                  <textarea
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text');
                      handleBulkEnvPaste(text);
                    }}
                    onChange={(e) => handleBulkEnvChange(e.target.value)}
                    placeholder="Paste multiple KEY=value pairs (one per line)&#10;API_URL=https://...&#10;SECRET=xxx"
                    className="w-full h-16 bg-zinc-900/50 border border-zinc-800/50 rounded-lg px-3 py-2 text-xs font-mono text-zinc-400 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-none"
                    disabled={isRunning}
                  />
                  <p className="text-[10px] text-zinc-600 mt-1">Paste KEY=value pairs (one per line)</p>
                </div>

                <div className="space-y-2">
                  {envVars.filter(e => e.key).map((env, index) => (
                    <div
                      key={index}
                      className="env-row group flex items-center gap-2 p-2 rounded-lg bg-zinc-900/30 border border-zinc-800/30 hover:border-zinc-700/50 transition-colors animate-pop-in"
                    >
                      <input
                        type="text"
                        value={env.key}
                        onChange={(e) => handleEnvChange(index, 'key', e.target.value)}
                        placeholder="KEY"
                        disabled={isRunning}
                        className="w-24 bg-transparent border-none text-xs font-mono text-zinc-300 uppercase placeholder-zinc-600 focus:outline-none disabled:cursor-not-allowed"
                      />
                      <span className="text-zinc-600 text-xs">=</span>
                      <input
                        type={showEnvValues ? 'text' : 'password'}
                        value={env.value}
                        onChange={(e) => handleEnvChange(index, 'value', e.target.value)}
                        placeholder="***"
                        disabled={isRunning}
                        className="flex-1 bg-transparent border-none text-xs font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none disabled:cursor-not-allowed"
                      />
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleRemoveEnv(index)}
                          disabled={isRunning || envVars.length === 1}
                          className="p-1 text-zinc-600 hover:text-red-400 rounded transition-colors disabled:opacity-30"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleAddEnv}
                  disabled={isRunning}
                  className="mt-2 w-full py-2 rounded-lg border border-dashed border-zinc-700/50 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400 transition-colors flex items-center justify-center gap-1.5 text-xs disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 animate-slide-up">
                <div className="flex items-center gap-2 text-red-400 mb-1">
                  <XCircle className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">Error</span>
                </div>
                <p className="text-[10px] text-red-300/80">{error}</p>
              </div>
            )}

            {/* Success */}
            {isComplete && (
              <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 animate-slide-up glow-emerald">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-medium text-white">Complete!</span>
                </div>
                <div className="space-y-2">
                  {deployResult?.repository && (
                    <a href={deployResult.repository} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-zinc-300 hover:text-white">
                      <FileCode className="w-3.5 h-3.5" />
                      Repository
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </a>
                  )}
                  {deployResult?.deployment && (
                    <a href={deployResult.deployment} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300">
                      <Zap className="w-3.5 h-3.5" />
                      Live Site
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </a>
                  )}
                </div>
                <button onClick={handleReset} className="mt-3 w-full py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white transition-colors text-xs flex items-center justify-center gap-1.5">
                  <RotateCcw className="w-3 h-3" />
                  Deploy Another
                </button>
              </div>
            )}

            {/* Deploy Button */}
            {!isComplete && (
              <button
                onClick={handleDeploy}
                disabled={!repoUrl || !githubToken || !projectName || isRunning}
                className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500 text-white font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    {deployMode === 'fast' ? 'Deploy to Sandbox' : 'Deploy to Production'}
                  </>
                )}
              </button>
            )}
          </div>

          {/* ===== RIGHT: TRANSFORMATION LOGS (60%) ===== */}
          <div className="w-[60%] glass-card rounded-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-zinc-800/50 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-zinc-300">Transformation Feed</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => useDeployStore.getState().clearLogs()}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Clear
                </button>
                <div className={`w-2 h-2 rounded-full ${status === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-black/30 font-mono text-sm">
              {logs.length > 0 ? (
                <div className="space-y-1">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`flex items-start gap-3 text-xs leading-relaxed ${
                        log.level === 'success' ? 'text-emerald-400' :
                        log.level === 'error' ? 'text-red-400' :
                        log.level === 'warning' ? 'text-amber-400' :
                        'text-zinc-400'
                      }`}
                    >
                      <span className="text-zinc-600 w-20 flex-shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="w-4 text-center flex-shrink-0">
                        {log.level === 'success' ? '✓' :
                         log.level === 'error' ? '✗' :
                         log.level === 'warning' ? '!' : '›'}
                      </span>
                      <span className="whitespace-pre-wrap">{log.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-700">
                  <Terminal className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">Waiting for input...</p>
                </div>
              )}
            </div>
          </div>

          {/* ===== FAR RIGHT: STATUS SPACER (10%) ===== */}
          <div className="w-[10%]" />
        </div>

        {/* ===== COMMAND BAR (Fixed Bottom) ===== */}
        {/* <CommandBar
          repoUrl={repoUrl}
          githubToken={githubToken}
          vercelToken={vercelToken}
          deployMode={deployMode}
          projectName={projectName}
          onDeploy={handleDeploy}
        /> */}
      </div>
    </div>
  );
}