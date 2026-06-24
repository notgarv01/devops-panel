import { useState } from 'react';
import {
  Globe,
  Github,
  Settings,
  Zap,
  RotateCcw,
  ExternalLink,
  ChevronRight,
  Loader2,
  Check,
  AlertTriangle,
  Clock,
  Server,
  FileCode,
  Layers
} from 'lucide-react';

// Framework icons mapping
const FRAMEWORK_ICONS = {
  vite: '⚡',
  next: '▲',
  react: '⚛',
  node: '◆',
  static: '□',
  unknown: '?'
};

const FRAMEWORK_LABELS = {
  vite: 'Vite',
  next: 'Next.js',
  react: 'React',
  node: 'Node',
  static: 'Static',
  unknown: 'Unknown'
};

// Status configuration
const STATUS_CONFIG = {
  live: {
    color: 'bg-emerald-500',
    glow: 'shadow-[0_0_10px_rgba(16,185,129,0.5)]',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    label: 'Live'
  },
  building: {
    color: 'bg-amber-500',
    glow: 'shadow-[0_0_10px_rgba(245,158,11,0.5)]',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
    label: 'Building'
  },
  failed: {
    color: 'bg-red-500',
    glow: 'shadow-[0_0_10px_rgba(239,68,68,0.5)]',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
    label: 'Failed'
  },
  pending: {
    color: 'bg-zinc-500',
    glow: '',
    border: 'border-zinc-500/30',
    text: 'text-zinc-400',
    dot: 'bg-zinc-400',
    label: 'Pending'
  },
  stopped: {
    color: 'bg-slate-500',
    glow: '',
    border: 'border-slate-500/30',
    text: 'text-slate-400',
    dot: 'bg-slate-400',
    label: 'Stopped'
  },
  queued: {
    color: 'bg-blue-500',
    glow: 'shadow-[0_0_10px_rgba(59,130,246,0.3)]',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
    label: 'Queued'
  }
};

export default function ProjectCard({ project, onClick, isSelected = false }) {
  const [isHovered, setIsHovered] = useState(false);

  const {
    name,
    framework = 'unknown',
    status = 'pending',
    vercelUrl,
    githubUrl,
    lastWebhookAt,
    lastDeployAt,
    owner
  } = project;

  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  // Calculate time since last sync
  const getTimeAgo = (date) => {
    if (!date) return 'Never';
    const now = new Date();
    const then = new Date(date);
    const seconds = Math.floor((now - then) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const isPulsing = status === 'building';

  return (
    <div
      className={`
        relative glass-card rounded-2xl p-5 cursor-pointer
        transition-all duration-300 ease-out
        hover:translate-y-[-2px] hover:shadow-lg
        ${isSelected ? statusConfig.border : 'border-zinc-800/50'}
        ${isHovered ? statusConfig.border : ''}
        ${isPulsing ? 'animate-pulse-subtle' : ''}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      style={{
        '--glow-color': statusConfig.glow
      }}
    >
      {/* Health Pulse - Top Right */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <span className={`
          w-2.5 h-2.5 rounded-full ${statusConfig.dot}
          ${isPulsing ? 'animate-pulse' : ''}
        `} />
      </div>

      {/* Framework Badge - Top Left */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg" title={FRAMEWORK_LABELS[framework]}>
          {FRAMEWORK_ICONS[framework] || '?'}
        </span>
        <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
          {FRAMEWORK_LABELS[framework] || 'Project'}
        </span>
      </div>

      {/* Project Name */}
      <h3 className="text-lg font-semibold text-white mb-1 truncate pr-8">
        {name}
      </h3>
      <p className="text-xs text-zinc-500 mb-4">
        {owner}
      </p>

      {/* Status Label */}
      <div className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        ${statusConfig.color}/10 border ${statusConfig.border}
        mb-4
      `}>
        <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} ${isPulsing ? 'animate-pulse' : ''}`} />
        <span className={`text-xs font-medium ${statusConfig.text}`}>
          {statusConfig.label}
        </span>
      </div>

      {/* Last Sync */}
      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
        <Clock className="w-3 h-3" />
        <span>
          {lastWebhookAt
            ? `Synced ${getTimeAgo(lastWebhookAt)} via Webhook`
            : lastDeployAt
              ? `Deployed ${getTimeAgo(lastDeployAt)}`
              : 'Not synced yet'
          }
        </span>
      </div>

      {/* Quick Links */}
      <div className="flex items-center gap-2 mt-auto pt-4 border-t border-zinc-800/50">
        {vercelUrl && (
          <a
            href={vercelUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-emerald-400 transition-colors"
            title="Live Site"
          >
            <Globe className="w-4 h-4" />
          </a>
        )}
        {githubUrl && (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-white transition-colors"
            title="GitHub Repository"
          >
            <Github className="w-4 h-4" />
          </a>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick(project);
          }}
          className="ml-auto p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-white transition-colors"
          title="Project Settings"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Hover Glow Effect */}
      {isHovered && (
        <div className={`
          absolute inset-0 rounded-2xl pointer-events-none
          ${statusConfig.glow}
        `} />
      )}
    </div>
  );
}

// Pulsing animation style (add to index.css if not present)
export const pulseAnimationStyle = `
@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}
.animate-pulse-subtle {
  animation: pulse-subtle 2s ease-in-out infinite;
}
`;