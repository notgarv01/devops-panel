import { useState, useCallback } from 'react';
import { Upload, FolderOpen, FileCode, Scan, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { deployService } from '../services/api';

const PROJECT_TYPE_LABELS = {
  STATIC: { label: 'Static Site', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  NODE_API: { label: 'Node.js API', color: 'text-green-400', bg: 'bg-green-500/20' },
  FRONTEND_FRAMEWORK: { label: 'Frontend Framework', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  MERN: { label: 'MERN Stack', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
};

export default function ProjectScanner({ onProjectDetected, onError }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [error, setError] = useState(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const folder = files[0]?.path;

    if (!folder) {
      setError('Please upload a folder, not individual files');
      return;
    }

    await scanProject(folder);
  }, []);

  const handleFileInput = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    const folder = files[0]?.path;

    if (folder) {
      await scanProject(folder);
    }
  }, []);

  const scanProject = async (projectPath) => {
    setIsScanning(true);
    setError(null);
    setScanResult(null);
    setScanProgress(0);

    try {
      // Simulate progress for UX feedback
      const progressInterval = setInterval(() => {
        setScanProgress(prev => Math.min(prev + Math.random() * 15, 90));
      }, 200);

      const result = await deployService.analyzeProject(projectPath);

      clearInterval(progressInterval);
      setScanProgress(100);

      setScanResult({
        path: projectPath,
        type: result.projectType.type,
        confidence: result.projectType.confidence,
        signals: result.projectType.signals,
        files: result.structure?.files || [],
        directories: result.structure?.directories || [],
      });

      if (onProjectDetected) {
        onProjectDetected({
          path: projectPath,
          type: result.projectType.type,
          ...result
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to analyze project');
      if (onError) onError(err);
    } finally {
      setIsScanning(false);
    }
  };

  const getTypeInfo = () => {
    if (!scanResult) return null;
    return PROJECT_TYPE_LABELS[scanResult.type] || {
      label: scanResult.type,
      color: 'text-gray-400',
      bg: 'bg-gray-500/20'
    };
  };

  return (
    <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl p-8 relative overflow-hidden">
      {/* Glow effect on active */}
      {isScanning && (
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-blue-500/5 animate-pulse" />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6 relative z-10">
        <div className={`p-3 rounded-xl ${isScanning ? 'bg-blue-500/20 animate-pulse' : 'bg-zinc-800'}`}>
          {isScanning ? (
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          ) : (
            <Scan className="w-6 h-6 text-zinc-400" />
          )}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white">Project Scanner</h2>
          <p className="text-sm text-zinc-500">Drop your folder to analyze project DNA</p>
        </div>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-10 transition-all duration-300 cursor-pointer
          ${isDragging
            ? 'border-blue-500 bg-blue-500/10 scale-[1.02]'
            : isScanning
              ? 'border-zinc-700 bg-zinc-900/50'
              : 'border-zinc-700 bg-zinc-900/50 hover:border-zinc-600'
          }
        `}
      >
        <input
          type="file"
          directory=""
          webkitdirectory=""
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isScanning}
        />

        <div className="flex flex-col items-center justify-center text-center">
          {isScanning ? (
            <>
              <Loader2 className="w-12 h-12 text-blue-400 mb-4 animate-spin" />
              <p className="text-lg text-white mb-2">Scanning Project...</p>
              <p className="text-sm text-zinc-500">{scanResult?.path}</p>

              {/* Progress bar */}
              <div className="w-full max-w-xs mt-4 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                  style={{ width: `${scanProgress}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <FolderOpen className="w-12 h-12 text-zinc-500 mb-4" />
              <p className="text-lg text-zinc-300 mb-1">Select or drag a folder</p>
              <p className="text-sm text-zinc-600">
                Supports React, Vue, Node.js, Express, and static HTML projects
              </p>
            </>
          )}
        </div>
      </div>

      {/* Scan Results */}
      {scanResult && (
        <div className="mt-6 space-y-4 relative z-10">
          {/* Detected Type */}
          <div className={`flex items-center gap-3 p-4 rounded-xl ${getTypeInfo()?.bg} border border-zinc-800`}>
            <CheckCircle className={`w-6 h-6 ${getTypeInfo()?.color}`} />
            <div className="flex-1">
              <p className="text-sm text-zinc-400">Detected Project Type</p>
              <p className={`text-lg font-semibold ${getTypeInfo()?.color}`}>
                {getTypeInfo()?.label}
                <span className="text-xs text-zinc-500 ml-2">
                  ({Math.round(scanResult.confidence * 100)}% confidence)
                </span>
              </p>
            </div>
          </div>

          {/* Signals */}
          {scanResult.signals?.length > 0 && (
            <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <p className="text-xs text-zinc-500 mb-2">Detected signals:</p>
              <div className="flex flex-wrap gap-2">
                {scanResult.signals.map((signal, i) => (
                  <span key={i} className="px-2 py-1 text-xs rounded-md bg-zinc-800 text-zinc-400">
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* File Preview */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <p className="text-xs text-zinc-500 mb-2 flex items-center gap-2">
              <FileCode className="w-3 h-3" />
              Project Structure ({scanResult.files?.length || 0} files)
            </p>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {scanResult.directories?.slice(0, 10).map((dir, i) => (
                <p key={i} className="text-xs text-zinc-400 font-mono">
                  📁 {dir}
                </p>
              ))}
              {scanResult.directories?.length > 10 && (
                <p className="text-xs text-zinc-600">... and {scanResult.directories.length - 10} more</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}