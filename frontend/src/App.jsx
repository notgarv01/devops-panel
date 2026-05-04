import { useState, useEffect } from 'react';
import Header from './components/Header';
import NewProjectForm from './components/NewProjectForm';
import DeploymentList from './components/DeploymentList';
import LogsTerminal from './components/LogsTerminal';
import { deployService } from './services/api';
import socket from './services/socket';

function App() {
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

      // Update selected deployment if it's the one receiving logs
      if (selectedDeployment && selectedDeployment._id === log.deploymentId) {
        setSelectedDeployment(prev => ({
          ...prev,
          logs: [...(prev.logs || []), { timestamp: log.timestamp, level: log.level, message: log.message }]
        }));
      }
    });

    // Also listen for status updates
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

  const handleSelectDeployment = (deployment) => {
    setSelectedDeployment(deployment);
  };

  return (
    <div className="min-h-screen bg-dark-900">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Form & List */}
          <div className="lg:col-span-1 space-y-6">
            <NewProjectForm onDeploy={handleDeploy} />

            <DeploymentList
              deployments={deployments}
              loading={loading}
              selectedId={selectedDeployment?._id}
              onSelect={handleSelectDeployment}
              onStop={handleStop}
              onDelete={handleDelete}
            />
          </div>

          {/* Right Column - Logs */}
          <div className="lg:col-span-2">
            <LogsTerminal deployment={selectedDeployment} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;