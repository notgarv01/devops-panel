import { Rocket, Loader2, ExternalLink } from 'lucide-react';
import { useDeployStore } from '../stores/deployStore';

export default function CommandBar({
  repoUrl,
  githubToken,
  vercelToken,
  deployMode,
  projectName,
  onDeploy
}) {
  const { status, progress, deployResult, error } = useDeployStore();

  const isRunning = ['analyzing', 'transforming', 'pushing', 'deploying'].includes(status);
  const isComplete = status === 'live' && deployResult;
  const hasError = status === 'error' || error;

  // URL validation
  const githubUrlRegex = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/;
  const isUrlValid = githubUrlRegex.test(repoUrl);
  const isUrlEntered = repoUrl && repoUrl.length > 0;

  // Generate target branch name from project name
  const targetBranch = projectName
    ? `devops-deploy-v${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 8)}`
    : null;

  const canActivate = repoUrl && githubToken && projectName && (deployMode === 'fast' || vercelToken);

  // Determine bar state
  const getBarState = () => {
    if (hasError) return 'error';
    if (isComplete) return 'success';
    if (isRunning) return 'running';
    if (canActivate) return 'ready';
    if (isUrlEntered && !isUrlValid) return 'invalid';
    return 'waiting';
  };

  const barState = getBarState();

  // Get command text based on state
  const getCommandText = () => {
    switch (barState) {
      case 'error':
        return 'TRANSMUTATION FAILED';
      case 'success':
        return 'DEPLOYMENT COMPLETE';
      case 'running':
        return `TRANSMUTING: ${progress.label || 'PROCESSING...'}`;
      case 'ready':
        return 'READY TO START MAGIC';
      case 'invalid':
        return 'INVALID URL FORMAT';
      default:
        return 'AWAITING REPOSITORY URL...';
    }
  };

  // Border color based on state
  const getBorderStyle = () => {
    switch (barState) {
      case 'error':
        return 'border-red-500/50';
      case 'success':
        return 'border-emerald-500/50';
      case 'ready':
        return 'border-cyan-500/60';
      case 'running':
        return 'border-cyan-500/30';
      case 'invalid':
        return 'border-red-500/50';
      default:
        return 'border-zinc-800/50';
    }
  };

  // Text color based on state
  const getTextColor = () => {
    switch (barState) {
      case 'error':
        return 'text-red-400';
      case 'success':
        return 'text-emerald-400';
      case 'ready':
        return 'text-white';
      case 'running':
        return 'text-cyan-300';
      case 'invalid':
        return 'text-red-400';
      default:
        return 'text-zinc-500';
    }
  };

  // Glow effect based on state
  const getGlowStyle = () => {
    switch (barState) {
      case 'error':
        return 'shadow-[0_-4px_20px_rgba(239,68,68,0.15)]';
      case 'success':
        return 'shadow-[0_-4px_20px_rgba(16,185,129,0.2)]';
      case 'ready':
        return 'shadow-[0_-4px_30px_rgba(0,212,255,0.2)]';
      case 'invalid':
        return 'shadow-[0_-4px_20px_rgba(239,68,68,0.15)]';
      default:
        return '';
    }
  };

  // Only show bar for meaningful states
  if (barState === 'waiting') return null;

  return (
    <div className={`
      fixed bottom-0 left-0 right-0 z-50
      bg-black border-t ${getBorderStyle()}
      transition-all duration-500 ${getGlowStyle()}
    `}>
      <div className="max-w-screen-2xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Left: Command Text */}
        <div className="flex items-center gap-4">
          <span className={`font-mono font-bold text-base tracking-wider ${getTextColor()} transition-colors duration-300`}>
            {getCommandText()}
          </span>

          {/* Target branch (shown when ready) */}
          {barState === 'ready' && targetBranch && (
            <div className="hidden md:flex items-center gap-2">
              <span className="text-zinc-600">|</span>
              <span className="text-xs text-zinc-500 font-mono">
                TARGET: <span className="text-cyan-400/70">{targetBranch}</span>
              </span>
            </div>
          )}
        </div>

        {/* Center: Progress (when running) */}
        <div className="flex-1 flex justify-center">
          {isRunning && progress.percentage > 0 && (
            <div className="flex items-center gap-3">
              <div className="w-48 h-1 bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
              <span className="text-xs text-zinc-500 font-mono">{progress.percentage}%</span>
            </div>
          )}
        </div>

        {/* Right: Action Button */}
        <div className="flex items-center gap-4">
          {isComplete && deployResult?.deployment && (
            <a
              href={deployResult.deployment}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="text-sm font-medium">View Live</span>
            </a>
          )}

          {isRunning ? (
            <button
              disabled
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-zinc-800 text-zinc-500 font-mono font-bold text-sm cursor-not-allowed"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              PROCESSING
            </button>
          ) : canActivate ? (
            <button
              onClick={onDeploy}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500 text-white font-mono font-bold text-sm hover:opacity-90 hover:shadow-[0_0_30px_rgba(0,212,255,0.3)] transition-all"
            >
              <Rocket className="w-4 h-4" />
              START MAGIC
            </button>
          ) : !isUrlValid && isUrlEntered ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="text-sm text-red-400">Invalid URL</span>
            </div>
          ) : deployMode === 'slow' && !vercelToken && githubToken ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
              <span className="text-sm text-purple-400">Add Vercel Token</span>
            </div>
          ) : !githubToken && repoUrl ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <span className="text-sm text-cyan-400">Add GitHub Token</span>
            </div>
          ) : (
            <button
              disabled
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-zinc-800 text-zinc-600 font-mono font-bold text-sm cursor-not-allowed opacity-50"
            >
              <Rocket className="w-4 h-4" />
              START MAGIC
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
