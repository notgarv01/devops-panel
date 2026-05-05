import { useState } from 'react';
import DeploymentPanel from './components/DeploymentPanel';
import { Rocket, Database, Layout } from 'lucide-react';

export default function VercelDeployView() {
  const [activeView, setActiveView] = useState('vercel');

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Header */}
      <header className="border-b border-zinc-800/50 bg-[#0F0F0F]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-xl border border-blue-500/20">
                <Rocket className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">DevOps Panel</h1>
                <p className="text-xs text-zinc-500">Transform & Deploy</p>
              </div>
            </div>

            {/* View Switcher */}
            <div className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-xl border border-zinc-800">
              <button
                onClick={() => setActiveView('vercel')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                  activeView === 'vercel'
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Rocket className="w-4 h-4" />
                Vercel Deploy
              </button>
              <button
                onClick={() => setActiveView('docker')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                  activeView === 'docker'
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Database className="w-4 h-4" />
                Docker Deploy
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="px-6 py-8">
        {activeView === 'vercel' && <DeploymentPanel />}
        {activeView === 'docker' && (
          <div className="text-center py-20">
            <Database className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-500">Docker deployment view coming soon...</p>
          </div>
        )}
      </main>
    </div>
  );
}