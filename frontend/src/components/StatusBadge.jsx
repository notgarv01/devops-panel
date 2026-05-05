import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

const STATUS_CONFIG = {
  pending: { color: 'text-zinc-400', bg: 'bg-zinc-500/20', dot: 'bg-zinc-400', label: 'Pending' },
  scanning: { color: 'text-blue-400', bg: 'bg-blue-500/20', dot: 'bg-blue-400 animate-pulse', label: 'Scanning' },
  cloning: { color: 'text-purple-400', bg: 'bg-purple-500/20', dot: 'bg-purple-400 animate-pulse', label: 'Cloning' },
  building: { color: 'text-amber-400', bg: 'bg-amber-500/20', dot: 'bg-amber-400 animate-pulse', label: 'Building' },
  running: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', dot: 'bg-emerald-400 animate-pulse', label: 'Live' },
  success: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', dot: 'bg-emerald-400', label: 'Live' },
  stopped: { color: 'text-zinc-500', bg: 'bg-zinc-500/20', dot: 'bg-zinc-500', label: 'Stopped' },
  error: { color: 'text-red-400', bg: 'bg-red-500/20', dot: 'bg-red-400', label: 'Failed' },
  transforming: { color: 'text-violet-400', bg: 'bg-violet-500/20', dot: 'bg-violet-400 animate-pulse', label: 'Transforming' },
  deploying: { color: 'text-cyan-400', bg: 'bg-cyan-500/20', dot: 'bg-cyan-400 animate-pulse', label: 'Deploying' },
};

export default function StatusBadge({ status, size = 'md', showIcon = true, className = '' }) {
  const config = STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.pending;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1.5',
    md: 'px-3 py-1 text-sm gap-2',
    lg: 'px-4 py-1.5 text-base gap-2.5',
  };

  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  };

  const icons = {
    running: <Wifi className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'}`} />,
    success: <CheckCircle2 className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'}`} />,
    error: <AlertTriangle className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'}`} />,
    building: <Loader2 className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} animate-spin`} />,
    scanning: <Loader2 className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} animate-spin`} />,
    transforming: <Loader2 className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} animate-spin`} />,
    deploying: <Loader2 className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} animate-spin`} />,
  };

  return (
    <span className={`
      inline-flex items-center rounded-full font-medium
      ${sizeClasses[size]}
      ${config.bg} ${config.color}
      ${className}
    `}>
      <span className={`rounded-full ${dotSizes[size]} ${config.dot}`} />
      {showIcon && icons[status?.toLowerCase()] && icons[status?.toLowerCase()]}
      {config.label}
    </span>
  );
}

export function LiveIndicator({ connected = false, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
      <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-zinc-500'}`}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      {connected ? (
        <Wifi className="w-3 h-3 text-emerald-400" />
      ) : (
        <WifiOff className="w-3 h-3 text-zinc-500" />
      )}
    </div>
  );
}