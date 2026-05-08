import { useState } from 'react';
import { Github, Check, Loader2 } from 'lucide-react';

export default function GitHubConnect({ onConnect, connected = false, username = '', avatar = '' }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      // Call backend to get OAuth URL
      const response = await fetch('/api/auth/github');
      const data = await response.json();

      if (data.error) {
        setError(data.message || data.error);
        setConnecting(false);
        return;
      }

      // Open GitHub OAuth in a popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        data.url,
        'github-oauth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Listen for OAuth callback
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          // Assume success if popup closed - in real app, use postMessage
          if (onConnect) onConnect();
          setConnecting(false);
        }
      }, 1000);

    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  };

  if (connected) {
    return (
      <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
        {avatar ? (
          <img
            src={avatar}
            alt={username}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
            <Github className="w-4 h-4 text-white" />
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white">{username}</span>
          <span className="text-xs text-emerald-400">Connected</span>
        </div>
        <Check className="w-4 h-4 text-emerald-400 ml-2" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="flex items-center gap-3 px-5 py-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-white hover:bg-zinc-800/50 hover:border-zinc-700/50 transition-all disabled:opacity-50"
      >
        {connecting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Connecting...</span>
          </>
        ) : (
          <>
            <Github className="w-5 h-5" />
            <span className="text-sm font-medium">Connect GitHub</span>
          </>
        )}
      </button>

      {error && (
        <p className="text-xs text-red-400 px-1">{error}</p>
      )}
    </div>
  );
}