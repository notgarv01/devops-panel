import { Rocket, Github } from 'lucide-react';

export default function Header() {
  return (
    <header className="bg-dark-800 border-b border-dark-600">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-500 rounded-lg">
              <Rocket className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">DevOps Panel</h1>
              <p className="text-xs text-gray-400">One-click deployments</p>
            </div>
          </div>

          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <Github className="w-5 h-5" />
            <span className="text-sm">Connect GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}