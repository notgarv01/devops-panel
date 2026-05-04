import { useState } from 'react';
import { Plus, Loader2, GitBranch, Server, Layers } from 'lucide-react';
import { deployService } from '../services/api';

export default function NewProjectForm({ onDeploy }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [projectType, setProjectType] = useState('single');
  const [envVars, setEnvVars] = useState([{ key: '', value: '' }]);
  const [envInputText, setEnvInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const parseEnvText = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) {
        return { key: line.trim(), value: '' };
      }
      const key = line.substring(0, eqIndex).trim();
      let value = line.substring(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return { key, value };
    }).filter(env => env.key);
  };

  // Auto-detect paste and set keys one by one
  const handleEnvInputChange = (text) => {
    setEnvInputText(text);
    // Detect multi-line paste (more than 1 key=value pair)
    const lines = text.split('\n').filter(l => l.includes('='));
    if (lines.length > 1) {
      // Multi-line paste detected - set all at once
      const parsed = parseEnvText(text);
      setEnvVars(parsed.length > 0 ? parsed : [{ key: '', value: '' }]);
    } else if (lines.length === 1 && text.includes('=')) {
      // Single line with key=value - add as new row if current last row has content
      const parsed = parseEnvText(text);
      if (parsed.length > 0) {
        setEnvVars([...envVars.filter(e => e.key || e.value), ...parsed]);
      }
      setEnvInputText('');
    }
  };

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
    setEnvInputText('');
  };

  const handleRemoveEnvVar = (index) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleEnvVarChange = (index, field, value) => {
    const updated = [...envVars];
    updated[index][field] = value;
    setEnvVars(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!repoUrl.trim()) {
      setError('Repository URL is required');
      return;
    }

    // Validate GitHub URL
    if (!repoUrl.includes('github.com') && !repoUrl.startsWith('http')) {
      setError('Please enter a valid GitHub repository URL');
      return;
    }

    setLoading(true);

    try {
      const validEnvVars = envVars.filter(e => e.key.trim() && e.value.trim());
      const result = await onDeploy({
        repoUrl: repoUrl.trim(),
        branch: branch.trim() || 'main',
        projectType,
        envVars: validEnvVars
      });

      setSuccess(`Deployment started! ID: ${result.deploymentId}`);
      setRepoUrl('');
      setEnvVars([{ key: '', value: '' }]);

      // Clear success message after 5 seconds
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start deployment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-6">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Plus className="w-5 h-5 text-accent-500" />
        New Deployment
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Project Type Selector */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Project Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setProjectType('single')}
              className={`p-3 rounded-lg border transition-all ${
                projectType === 'single'
                  ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                  : 'border-dark-500 text-gray-400 hover:border-dark-400'
              }`}
            >
              <Server className="w-5 h-5 mx-auto mb-1" />
              <span className="text-sm">Single Service</span>
            </button>
            <button
              type="button"
              onClick={() => setProjectType('mern')}
              className={`p-3 rounded-lg border transition-all ${
                projectType === 'mern'
                  ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                  : 'border-dark-500 text-gray-400 hover:border-dark-400'
              }`}
            >
              <Layers className="w-5 h-5 mx-auto mb-1" />
              <span className="text-sm">MERN Stack</span>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {projectType === 'mern'
              ? 'Deploys MongoDB + Express + React together'
              : 'Deploys a single container service'}
          </p>
        </div>

        {/* Repository URL */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Repository URL</label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder={projectType === 'mern' ? 'https://github.com/user/my-mern-app' : 'https://github.com/user/repo'}
            className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-accent-500 transition-colors"
          />
          {projectType === 'mern' && (
            <p className="text-xs text-gray-500 mt-1">
              For MERN: repo should have server/ or backend/ folder with Express API
            </p>
          )}
        </div>

        {/* Branch */}
        <div>
          <label className="block text-sm text-gray-400 mb-2 flex items-center gap-1">
            <GitBranch className="w-4 h-4" />
            Branch
          </label>
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
            className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-accent-500 transition-colors"
          />
        </div>

        {/* Environment Variables */}
        <div>
          <label className="text-sm text-gray-400 mb-2">Environment Variables</label>
          <div className="space-y-2">
            {envVars.map((env, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={env.key}
                  onChange={(e) => handleEnvVarChange(index, 'key', e.target.value)}
                  placeholder="KEY"
                  className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-accent-500"
                />
                <input
                  type="text"
                  value={env.value}
                  onChange={(e) => handleEnvVarChange(index, 'value', e.target.value)}
                  placeholder="value"
                  className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-accent-500"
                />
                {envVars.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveEnvVar(index)}
                    className="px-2 text-gray-500 hover:text-red-400"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {/* Paste detection input */}
            <input
              type="text"
              value={envInputText}
              onChange={(e) => handleEnvInputChange(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                setTimeout(() => handleEnvInputChange(pasted), 0);
              }}
              placeholder="Paste multiple keys (KEY=value format) - auto-detects on paste"
              className="w-full bg-dark-700/50 border border-dashed border-dark-500 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-accent-500 font-mono"
            />
            <button
              type="button"
              onClick={handleAddEnvVar}
              className="text-xs text-accent-500 hover:text-accent-400"
            >
              + Add Variable
            </button>
            <p className="text-xs text-yellow-500/70 mt-1">
              Note: MONGODB_URI is auto-generated. Do NOT include it here.
            </p>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
            {success}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent-500 hover:bg-accent-600 disabled:bg-dark-500 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Deploying...
            </>
          ) : (
            <>
              <Plus className="w-5 h-5" />
              Deploy Project
            </>
          )}
        </button>
      </form>
    </div>
  );
}