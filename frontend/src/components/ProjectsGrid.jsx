import { useState, useEffect } from 'react';
import {
  Grid3X3,
  Plus,
  RefreshCw,
  Loader2,
  Zap,
  Settings
} from 'lucide-react';
import ProjectCard from './ProjectCard';
import ProjectModal from './ProjectModal';
import GitHubConnect from './GitHubConnect';
import { deployService } from '../services/api';
import socket from '../services/socket';

export default function ProjectsGrid({ vercelToken, onDeployNew }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUser, setGithubUser] = useState(null);

  useEffect(() => {
    loadProjects();

    // Listen for real-time project updates
    socket.on('project-update', (data) => {
      console.log('[ProjectsGrid] project-update:', data);
      // Update the project in the list
      setProjects(prev => prev.map(p =>
        p.name === data.projectName
          ? { ...p, status: data.status, vercelUrl: data.url || p.vercelUrl }
          : p
      ));
    });

    return () => {
      socket.off('project-update');
    };
  }, []);

  const loadProjects = async () => {
    try {
      const data = await deployService.getProjects();
      setProjects(data || []);
    } catch (error) {
      console.error('Failed to load projects:', error);
      // Fallback to empty array - can be shown in command center mode
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadProjects();
    setRefreshing(false);
  };

  const handleProjectClick = (project) => {
    setSelectedProject(project);
  };

  const handleCloseModal = () => {
    setSelectedProject(null);
  };

  const handleStatusUpdate = (projectId, newStatus) => {
    setProjects(projects.map(p =>
      p._id === projectId ? { ...p, status: newStatus } : p
    ));
  };

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <span className="text-zinc-500 text-sm">Loading projects...</span>
        </div>
      </div>
    );
  }

  // Empty state - no projects yet
  if (projects.length === 0) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 flex items-center justify-center mx-auto mb-6">
              <Grid3X3 className="w-8 h-8 text-zinc-600" />
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">
              No Projects Yet
            </h2>
            <p className="text-zinc-500 mb-6">
              Deploy your first project to see it appear here. Your Zero-Manual workflow starts with a single GitHub URL.
            </p>
            <button
              onClick={onDeployNew}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500 text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Deploy First Project
            </button>
          </div>
        </div>

        {/* Command Center for initial deployment */}
        <div className="h-[70vh]">
          {onDeployNew && typeof onDeployNew === 'function' ? null : (
            <div className="h-full flex items-center justify-center text-zinc-600">
              <span className="text-sm">Configure Command Center to start deploying</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-xl border-b border-zinc-800/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-semibold text-white">Fleet Manager</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs">
              {projects.length} {projects.length === 1 ? 'Project' : 'Projects'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* GitHub Connection Status */}
            <GitHubConnect
              connected={githubConnected}
              username={githubUser?.username}
              avatar={githubUser?.avatar}
              onConnect={() => setGithubConnected(true)}
            />

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onDeployNew}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Deploy
            </button>
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project, index) => (
            <div
              key={project._id}
              className="animate-fade-in"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <ProjectCard
                project={project}
                onClick={handleProjectClick}
                isSelected={selectedProject?._id === project._id}
              />
            </div>
          ))}
        </div>
      </main>

      {/* Modal */}
      {selectedProject && (
        <ProjectModal
          project={selectedProject}
          onClose={handleCloseModal}
          vercelToken={vercelToken}
        />
      )}
    </div>
  );
}