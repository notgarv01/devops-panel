import { Loader2, Play, Square, Trash2, ExternalLink, Server, Database, Globe, Box } from 'lucide-react';

const statusConfig = {
  pending: { color: 'bg-yellow-500', text: 'Pending' },
  cloning: { color: 'bg-blue-500', text: 'Cloning' },
  building: { color: 'bg-purple-500', text: 'Building' },
  running: { color: 'bg-green-500', text: 'Running' },
  stopped: { color: 'bg-gray-500', text: 'Stopped' },
  error: { color: 'bg-red-500', text: 'Error' },
  deleted: { color: 'bg-gray-600', text: 'Deleted' },
};

const serviceIcons = {
  app: Server,
  mongo: Database,
  frontend: Globe,
  redis: Box,
};

const serviceLabels = {
  app: 'API',
  mongo: 'DB',
  frontend: 'Web',
  redis: 'Cache',
};

function formatDate(date) {
  if (!date) return '-';
  return new Date(date).toLocaleString();
}

export default function DeploymentList({ deployments, loading, selectedId, onSelect, onStop, onDelete }) {
  if (loading) {
    return (
      <div className="bg-dark-800 rounded-xl border border-dark-600 p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 overflow-hidden">
      <div className="p-4 border-b border-dark-600">
        <h2 className="text-lg font-semibold text-white">Active Deployments</h2>
        <p className="text-sm text-gray-400">{deployments.length} project{deployments.length !== 1 ? 's' : ''}</p>
      </div>

      {deployments.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <p>No deployments yet</p>
          <p className="text-sm mt-1">Create your first deployment above</p>
        </div>
      ) : (
        <div className="divide-y divide-dark-600">
          {deployments.map((deployment) => {
            const status = statusConfig[deployment.status] || statusConfig.pending;
            const isSelected = selectedId === deployment._id;
            const containers = deployment.containers || [];
            const isMern = deployment.projectType === 'mern';

            // Get primary URL for the external link button
            const primaryContainer = containers.find(c => c.name === 'app' || c.name === 'frontend');
            const primaryPort = primaryContainer?.hostPort || deployment.hostPort;

            return (
              <div
                key={deployment._id}
                onClick={() => onSelect(deployment)}
                className={`p-4 hover:bg-dark-700 cursor-pointer transition-colors ${isSelected ? 'bg-dark-700' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white truncate">{deployment.projectName}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs text-white ${status.color}`}>
                        {status.text}
                      </span>
                      {isMern && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          MERN
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-1">{deployment.repoUrl}</p>

                    {/* Services badges for MERN deployments */}
                    {containers.length > 0 && (
                      <div className="flex items-center gap-1 mt-2">
                        {containers.map((container) => {
                          const Icon = serviceIcons[container.name] || Server;
                          const label = serviceLabels[container.name] || container.name;
                          return (
                            <div
                              key={container.name}
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-dark-600 text-xs text-gray-400"
                              title={`${container.name}: ${container.hostPort || 'N/A'}`}
                            >
                              <Icon className="w-3 h-3" />
                              <span>{label}</span>
                              {container.hostPort && (
                                <span className="text-gray-500">:{container.hostPort}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Fallback to simple port display for single-service */}
                    {containers.length === 0 && (
                      <p className="text-xs text-gray-600 mt-1">
                        {deployment.hostPort ? `Port: ${deployment.hostPort}` : 'Port: -'}
                      </p>
                    )}

                    <p className="text-xs text-gray-600">
                      {deployment.deployedAt ? `Deployed: ${formatDate(deployment.deployedAt)}` : `Created: ${formatDate(deployment.createdAt)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    {deployment.status === 'running' && (
                      <>
                        {primaryPort && (
                          <a
                            href={`http://localhost:${primaryPort}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-2 text-gray-400 hover:text-accent-500 transition-colors"
                            title="Open in browser"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onStop(deployment._id); }}
                          className="p-2 text-gray-400 hover:text-yellow-500 transition-colors"
                          title="Stop"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      </>
                    )}

                    {deployment.status === 'stopped' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(deployment._id); }}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    {deployment.status === 'error' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(deployment._id); }}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}