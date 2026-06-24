import { useState, useEffect } from 'react';
import { Zap, LayoutGrid, Plus, Home } from 'lucide-react';
import CommandCenter from './components/CommandCenter';
import ProjectsGrid from './components/ProjectsGrid';
import LandingPage from './components/LandingPage';
import { initializeSocketListeners } from './stores/deployStore';

function App() {
  const [view, setView] = useState('landing'); // 'landing', 'fleet', or 'deploy'
  const [vercelToken, setVercelToken] = useState('');

  useEffect(() => {
    initializeSocketListeners();
  }, []);

  const handleDeployNew = () => {
    setView('deploy');
  };

  const handleBackToFleet = () => {
    setView('fleet');
  };

  const handleGoToLanding = () => {
    setView('landing');
  };

  const handleGoToPanel = () => {
    setView('fleet');
  };

  return (
    <div className="min-h-screen bg-black">
      {view === 'landing' ? (
        <LandingPage onGoToPanel={handleGoToPanel} />
      ) : view === 'fleet' ? (
        <>
          {/* Fleet Manager Header */}
          <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-xl border-b border-zinc-800/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-4 lg:gap-6 min-w-0">
                {/* Logo */}
                <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={handleGoToLanding}>
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 flex-shrink-0">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-lg sm:text-xl font-bold text-white tracking-tight truncate">Auto DeployX</span>
                    <span className="block text-[10px] text-zinc-500 -mt-0.5">Zero-Manual Infrastructure</span>
                  </div>
                </div>

                {/* Nav */}
                <nav className="hidden md:flex items-center gap-1">
                  <button
                    onClick={handleGoToLanding}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-all"
                  >
                    <Home className="w-4 h-4" />
                    Home
                  </button>
                  <button
                    onClick={handleBackToFleet}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                      ${view === 'fleet'
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                      }
                    `}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    Fleet Manager
                  </button>
                  <button
                    onClick={handleDeployNew}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                      ${view === 'deploy'
                        ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                      }
                    `}
                  >
                    <Plus className="w-4 h-4" />
                    Deploy New
                  </button>
                </nav>
              </div>

              {/* Status */}
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="hidden sm:flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-zinc-500">Systems Online</span>
                </div>
              </div>
            </div>
          </header>

          {/* Mobile Nav */}
          <div className="md:hidden border-b border-zinc-800/50 bg-black/50 px-4 py-2 flex gap-2">
            <button
              onClick={handleGoToLanding}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-zinc-500"
            >
              Home
            </button>
            <button
              onClick={handleBackToFleet}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                view === 'fleet' ? 'bg-cyan-500/10 text-cyan-400' : 'text-zinc-500'
              }`}
            >
              Fleet
            </button>
            <button
              onClick={handleDeployNew}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                view === 'deploy' ? 'bg-purple-500/10 text-purple-400' : 'text-zinc-500'
              }`}
            >
              Deploy
            </button>
          </div>

          {/* Main Content */}
          <main>
            <ProjectsGrid vercelToken={vercelToken} onDeployNew={handleDeployNew} onGoToLanding={handleGoToLanding} />
          </main>
        </>
      ) : (
        <>
          {/* Deploy View Header */}
          <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-xl border-b border-zinc-800/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-4 lg:gap-6 min-w-0">
                <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={handleGoToLanding}>
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 flex-shrink-0">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-lg sm:text-xl font-bold text-white tracking-tight truncate">Auto DeployX</span>
                    <span className="block text-[10px] text-zinc-500 -mt-0.5">Zero-Manual Infrastructure</span>
                  </div>
                </div>

                <nav className="hidden md:flex items-center gap-1">
                  <button
                    onClick={handleGoToLanding}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-all"
                  >
                    <Home className="w-4 h-4" />
                    Home
                  </button>
                  <button
                    onClick={handleBackToFleet}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-all"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    Fleet Manager
                  </button>
                  <button
                    onClick={handleDeployNew}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20"
                  >
                    <Plus className="w-4 h-4" />
                    Deploy New
                  </button>
                </nav>
              </div>

              <button
                onClick={handleBackToFleet}
                className="hidden sm:inline text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
              >
                Back to Fleet
              </button>
            </div>
          </header>

          {/* Mobile Nav */}
          <div className="md:hidden border-b border-zinc-800/50 bg-black/50 px-4 py-2 flex gap-2">
            <button
              onClick={handleGoToLanding}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-zinc-500"
            >
              Home
            </button>
            <button
              onClick={handleBackToFleet}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                view === 'fleet' ? 'bg-cyan-500/10 text-cyan-400' : 'text-zinc-500'
              }`}
            >
              Fleet
            </button>
            <button
              onClick={handleDeployNew}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                view === 'deploy' ? 'bg-purple-500/10 text-purple-400' : 'text-zinc-500'
              }`}
            >
              Deploy
            </button>
          </div>

          {/* Main Content */}
          <main className="min-h-[calc(100vh-120px)]">
            <CommandCenter />
          </main>
        </>
      )}
    </div>
  );
}

export default App;
