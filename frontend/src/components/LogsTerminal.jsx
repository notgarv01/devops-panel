import { useEffect, useRef, useState } from 'react';
import { Terminal, Copy, Check, Trash2 } from 'lucide-react';
import { connectToDeployment, disconnectFromDeployment } from '../services/socket';

const logColors = {
  info: 'text-gray-300',
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
};

export default function LogsTerminal({ deployment }) {
  const logsEndRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const logsContainerRef = useRef(null);

  useEffect(() => {
    if (deployment?._id) {
      connectToDeployment(deployment._id);
      return () => disconnectFromDeployment(deployment._id);
    }
  }, [deployment?._id]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [deployment?.logs]);

  const handleCopyLogs = () => {
    if (deployment?.logs) {
      const logsText = deployment.logs
        .map(log => `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] ${log.message}`)
        .join('\n');
      navigator.clipboard.writeText(logsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClearLogs = () => {
    // This would require a backend call to clear logs
    // For now, we just show a placeholder
  };

  if (!deployment) {
    return (
      <div className="bg-dark-800 rounded-xl border border-dark-600 h-[500px] flex flex-col">
        <div className="p-4 border-b border-dark-600 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-white">Build Logs</h2>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <Terminal className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Select a deployment to view logs</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 h-[600px] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-dark-600 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-accent-500" />
          <h2 className="text-lg font-semibold text-white">Build Logs</h2>
          <span className="text-sm text-gray-500">| {deployment.projectName}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLogs}
            className="p-2 text-gray-400 hover:text-white transition-colors"
            title="Copy logs"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div
        ref={logsContainerRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm bg-dark-900"
      >
        {deployment.logs && deployment.logs.length > 0 ? (
          <div className="space-y-1">
            {deployment.logs.map((log, index) => (
              <div key={index} className={`${logColors[log.level] || logColors.info} flex`}>
                <span className="text-gray-600 mr-2 flex-shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="uppercase text-xs mr-2 flex-shrink-0 w-16">
                  [{log.level}]
                </span>
                <span className="whitespace-pre-wrap break-all">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        ) : (
          <div className="text-gray-500 text-center py-8">
            <p>Waiting for logs...</p>
            <p className="text-xs mt-2 text-gray-600">Logs will appear here once the deployment starts</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="p-3 border-t border-dark-600 bg-dark-700 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-gray-400">
            Status: <span className="text-white uppercase">{deployment.status}</span>
          </span>
          {deployment.projectType === 'mern' && deployment.containers?.length > 0 ? (
            <>
              {deployment.containers.map(container => {
                const label = container.name === 'app' ? 'API' : container.name === 'mongo' ? 'DB' : container.name === 'redis' ? 'Cache' : 'Web';
                return container.hostPort && container.name !== 'redis' ? (
                  <span key={container.name} className="text-gray-400">
                    {label}:
                    <a href={`http://localhost:${container.hostPort}`} className="text-accent-500 hover:underline ml-1" target="_blank" rel="noopener noreferrer">
                      :{container.hostPort}
                    </a>
                  </span>
                ) : container.name === 'redis' ? (
                  <span key={container.name} className="text-gray-400">
                    {label}: :{container.hostPort}
                  </span>
                ) : null;
              })}
              <span className="text-gray-500">| MongoDB: :27017</span>
            </>
          ) : deployment.hostPort ? (
            <span className="text-gray-400">
              URL: <a href={`http://localhost:${deployment.hostPort}`} className="text-accent-500 hover:underline" target="_blank" rel="noopener noreferrer">
                localhost:{deployment.hostPort}
              </a>
            </span>
          ) : null}
        </div>
        <div className="text-gray-500">
          {deployment.logs?.length || 0} log entries
        </div>
      </div>
    </div>
  );
}