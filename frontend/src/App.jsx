import { useState, useEffect } from 'react';
import Header from './components/Header';
import CommandCenter from './components/CommandCenter';
import DeploymentPanel from './components/DeploymentPanel';
import NewProjectForm from './components/NewProjectForm';
import DeploymentList from './components/DeploymentList';
import LogsTerminal from './components/LogsTerminal';
import { deployService } from './services/api';
import socket from './services/socket';

function App() {
  const [activeTab, setActiveTab] = useState('command');
  const [deployments, setDeployments] = useState([]);
  const [selectedDeployment, setSelectedDeployment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDeployments();
  }, []);

  useEffect(() => {
    socket.on('deployment-log', (log) => {
      setDeployments(prev => prev.map(d => {
        if (d._id === log.deploymentId) {
          return {
            ...d,
            logs: [...(d.logs || []), { timestamp: log.timestamp, level: log.level, message: log.message }]
          };
        }
        return d;
      }));

      if (selectedDeployment && selectedDeployment._id === log.deploymentId) {
        setSelectedDeployment(prev => ({
          ...prev,
          logs: [...(prev.logs || []), { timestamp: log.timestamp, level: log.level, message: log.message }]
        }));
      }
    });

    socket.on('deployment-status', (data) => {
      setDeployments(prev => prev.map(d => {
        if (d._id === data.deploymentId) {
          return { ...d, status: data.status };
        }
        return d;
      }));

      if (selectedDeployment && selectedDeployment._id === data.deploymentId) {
        setSelectedDeployment(prev => ({ ...prev, status: data.status }));
      }
    });

    return () => {
      socket.off('deployment-log');
      socket.off('deployment-status');
    };
  }, [selectedDeployment]);

  const loadDeployments = async () => {
    try {
      const data = await deployService.getDeployments();
      setDeployments(data);
    } catch (error) {
      console.error('Failed to load deployments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeploy = async (formData) => {
    try {
      const result = await deployService.createDeployment(formData);
      await loadDeployments();
      return result;
    } catch (error) {
      throw error;
    }
  };

  const handleStop = async (id) => {
    try {
      await deployService.stopDeployment(id);
      await loadDeployments();
    } catch (error) {
      console.error('Failed to stop deployment:', error);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deployService.deleteDeployment(id);
      if (selectedDeployment?._id === id) {
        setSelectedDeployment(null);
      }
      await loadDeployments();
    } catch (error) {
      console.error('Failed to delete deployment:', error);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505]">
      <Header />

      {/* Tab Switcher */}
      <div className="border-b border-zinc-800/50 bg-[#0F0F0F]/50 backdrop-blur-xl sticky top-16 z-40">
        <div className="container mx-auto px-4">
          <div className="flex gap-1 py-2">
            <button
              onClick={() => setActiveTab('command')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'command'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Command Center
            </button>
            <button
              onClick={() => setActiveTab('pipeline')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'pipeline'
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Deploy Panel
            </button>
            <button
              onClick={() => setActiveTab('docker')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'docker'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Docker Deploy
            </button>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6">
        {activeTab === 'command' && <CommandCenter />}

        {activeTab === 'pipeline' && <DeploymentPanel />}

        {activeTab === 'docker' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <NewProjectForm onDeploy={handleDeploy} />
              <DeploymentList
                deployments={deployments}
                loading={loading}
                selectedId={selectedDeployment?._id}
                onSelect={setSelectedDeployment}
                onStop={handleStop}
                onDelete={handleDelete}
              />
            </div>
            <div className="lg:col-span-2">
              <LogsTerminal deployment={selectedDeployment} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;