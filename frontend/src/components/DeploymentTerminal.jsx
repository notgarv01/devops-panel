import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal, Copy, Check, Download, Maximize2, Minimize2 } from 'lucide-react';
import socket from '../services/socket';

const LOG_COLORS = {
  info: 'text-zinc-300',
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
};

const LOG_ICONS = {
  info: '›',
  success: '✓',
  error: '✗',
  warning: '⚠',
};

export default function DeploymentTerminal({ sessionId, title = 'Deployment Terminal', autoConnect = true }) {
  const [logs, setLogs] = useState([]);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const logsEndRef = useRef(null);
  const logsContainerRef = useRef(null);

  useEffect(() => {
    if (!autoConnect || !sessionId) return;

    const handleLog = (log) => {
      setLogs(prev => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: log.timestamp || new Date(),
        level: log.level || 'info',
        message: log.message
      }]);
    };

    socket.on('ship-log', handleLog);
    socket.on('vercel-log', handleLog);
    socket.on('deployment-log', handleLog);
    socket.on('transform-progress', (data) => {
      setLogs(prev => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
        level: 'info',
        message: `[TRANSFORM] ${data.message || JSON.stringify(data)}`
      }]);
    });

    return () => {
      socket.off('ship-log');
      socket.off('vercel-log');
      socket.off('deployment-log');
      socket.off('transform-progress');
    };
  }, [sessionId, autoConnect]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleCopyLogs = useCallback(() => {
    const logsText = logs
      .map(log => `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.level.toUpperCase().padEnd(7)} ${log.message}`)
      .join('\n');
    navigator.clipboard.writeText(logsText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [logs]);

  const handleDownloadLogs = useCallback(() => {
    const logsText = logs
      .map(log => `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deployment-${sessionId || 'logs'}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs, sessionId]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  if (!sessionId && autoConnect) {
    return (
      <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl flex flex-col h-80">
        <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-zinc-500" />
          <span className="text-zinc-400">{title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600">
          <p className="text-sm">Waiting for deployment to start...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#0F0F0F] border border-zinc-800 rounded-2xl flex flex-col overflow-hidden transition-all duration-300 ${
      isExpanded ? 'h-[600px]' : 'h-96'
    }`}>
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <Terminal className="w-5 h-5 text-emerald-400" />
          <span className="text-white font-medium">{title}</span>
          {sessionId && (
            <span className="text-xs text-zinc-600 font-mono">
              {sessionId.substring(0, 20)}...
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyLogs}
            className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Copy logs"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={handleDownloadLogs}
            className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Download logs"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={clearLogs}
            className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Clear logs"
          >
            <span className="text-xs">CLR</span>
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div
        ref={logsContainerRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm bg-[#050505] select-text scroll-smooth"
      >
        {logs.length > 0 ? (
          <div className="space-y-1">
            {logs.map((log) => (
              <div key={log.id} className={`flex items-start gap-2 ${LOG_COLORS[log.level] || LOG_COLORS.info}`}>
                <span className="text-zinc-600 text-xs w-16 flex-shrink-0 pt-0.5">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="w-4 flex-shrink-0 text-center">
                  {LOG_ICONS[log.level] || '›'}
                </span>
                <span className="whitespace-pre-wrap break-all leading-relaxed">
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-700">
            <Terminal className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">Terminal ready</p>
            <p className="text-xs text-zinc-800 mt-1">Logs will appear here...</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <span className="text-zinc-500">
            Lines: <span className="text-zinc-400">{logs.length}</span>
          </span>
          <span className="text-zinc-500">
            Session: <span className="text-zinc-400 font-mono">{sessionId || 'N/A'}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400">Connected</span>
        </div>
      </div>
    </div>
  );
}