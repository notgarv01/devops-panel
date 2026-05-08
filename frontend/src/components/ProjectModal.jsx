import { useState, useEffect } from 'react';
import {
  X,
  Globe,
  Github,
  Server,
  Key,
  RefreshCw,
  ExternalLink,
  Loader2,
  Check,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Zap,
  RotateCcw,
  Brain,
  MessageSquare,
  Gauge,
  Activity,
  Settings2,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import { deployService } from '../services/api';
import socket from '../services/socket';

export default function ProjectModal({ project, onClose, vercelToken }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [deployments, setDeployments] = useState([]);
  const [loadingDeployments, setLoadingDeployments] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [envVars, setEnvVars] = useState([]);
  const [showEnvValues, setShowEnvValues] = useState(false);
  const [customDomain, setCustomDomain] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [domainStatus, setDomainStatus] = useState(null);
  const [aiDiagnosis, setAiDiagnosis] = useState(project.aiDiagnosis || null);
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const [webVitals, setWebVitals] = useState(null);
  const [loadingVitals, setLoadingVitals] = useState(false);
  const [edgeConfig, setEdgeConfig] = useState({ items: [], editing: false, newKey: '', newValue: '' });

  const {
    name,
    framework,
    status,
    vercelUrl,
    githubUrl,
    vercelProjectId,
    owner,
    repoUrl,
    targetBranch,
    lastWebhookAt,
    lastDeployAt
  } = project;

  // Load deployment history
  useEffect(() => {
    if (activeTab === 'rollback' && vercelToken) {
      loadDeployments();
    }
  }, [activeTab, vercelToken]);

  // Listen for AI insights from pipeline
  useEffect(() => {
    if (!project._id) return;

    const handleAiInsight = (data) => {
      if (data.diagnosis) {
        setAiDiagnosis(data.diagnosis);
        setShowDiagnosis(true);
      }
    };

    socket.on('ai-insight', handleAiInsight);
    return () => socket.off('ai-insight', handleAiInsight);
  }, [project._id]);

  // Load Web Vitals
  useEffect(() => {
    if (activeTab === 'vitals' && vercelToken && vercelProjectId) {
      loadWebVitals();
    }
  }, [activeTab, vercelToken, vercelProjectId]);

  const loadWebVitals = async () => {
    setLoadingVitals(true);
    try {
      const response = await fetch(`/api/vercel/vitals/${vercelProjectId}`, {
        headers: { 'x-vercel-token': vercelToken }
      });
      if (response.ok) {
        const data = await response.json();
        setWebVitals(data);
      }
    } catch (error) {
      console.error('Failed to load Web Vitals:', error);
    } finally {
      setLoadingVitals(false);
    }
  };

  const getSpeedLabel = (status) => {
    switch (status) {
      case 'blazing': return { text: 'Blazing Fast', emoji: '⚡', color: 'text-emerald-400' };
      case 'fast': return { text: 'Fast', emoji: '🚀', color: 'text-cyan-400' };
      case 'moderate': return { text: 'Moderate', emoji: '🟡', color: 'text-amber-400' };
      case 'slow': return { text: 'Needs Optimization', emoji: '🐌', color: 'text-red-400' };
      default: return { text: 'Unknown', emoji: '❓', color: 'text-zinc-400' };
    }
  };

  const loadDeployments = async () => {
    setLoadingDeployments(true);
    try {
      // Note: In a real implementation, you'd call the backend which fetches from Vercel
      // For now, we'll simulate with empty data
      setDeployments([]);
    } catch (error) {
      console.error('Failed to load deployments:', error);
    } finally {
      setLoadingDeployments(false);
    }
  };

  const handleRollback = async (deploymentId) => {
    if (!confirm('Are you sure you want to rollback? This will trigger a new deployment.')) {
      return;
    }

    setRollingBack(true);
    try {
      const result = await deployService.deployToVercel({
        vercelToken,
        projectId: vercelProjectId,
        deploymentId,
        action: 'rollback'
      });
      console.log('Rollback triggered:', result);
    } catch (error) {
      console.error('Rollback failed:', error);
    } finally {
      setRollingBack(false);
    }
  };

  const handleAddDomain = async () => {
    if (!customDomain || !vercelToken) return;

    setAddingDomain(true);
    setDomainStatus(null);

    try {
      const result = await fetch(`/api/projects/${project._id}/domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vercelToken, domain: customDomain })
      }).then(r => r.json());

      if (result.success) {
        setDomainStatus({ success: true, message: 'Domain added successfully' });
        setCustomDomain('');
      } else {
        setDomainStatus({ success: false, message: result.error || 'Failed to add domain' });
      }
    } catch (error) {
      setDomainStatus({ success: false, message: error.message });
    } finally {
      setAddingDomain(false);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Server },
    { id: 'rollback', label: 'Rollback', icon: RotateCcw },
    { id: 'vitals', label: 'Performance', icon: Gauge },
    { id: 'domains', label: 'Domains', icon: Globe },
    { id: 'edgeconfig', label: 'Edge Config', icon: Settings2 }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl glass-card rounded-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800/50">
          <div>
            <h2 className="text-xl font-semibold text-white">{name}</h2>
            <p className="text-sm text-zinc-500">{owner}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800/50">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 flex items-center justify-center gap-2 px-4 py-3
                text-sm font-medium transition-colors
                ${activeTab === tab.id
                  ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-500/5'
                  : 'text-zinc-500 hover:text-zinc-300'
                }
              `}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Status */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                <div className="flex items-center gap-3">
                  <div className={`
                    w-3 h-3 rounded-full
                    ${status === 'live' ? 'bg-emerald-400' :
                      status === 'building' ? 'bg-amber-400 animate-pulse' :
                      status === 'failed' ? 'bg-red-400' : 'bg-zinc-400'}
                  `} />
                  <span className="text-white font-medium capitalize">{status}</span>
                </div>
                <span className="text-xs text-zinc-500">
                  {lastDeployAt ? `Last deploy: ${new Date(lastDeployAt).toLocaleString()}` : 'Never'}
                </span>
              </div>

              {/* AI Insight Badge */}
              {aiDiagnosis && (
                <button
                  onClick={() => setShowDiagnosis(!showDiagnosis)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/30 hover:border-purple-500/50 transition-colors text-left"
                >
                  <Brain className="w-5 h-5 text-purple-400" />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-purple-400 flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5" />
                      AI Insight Available
                    </span>
                    <p className="text-xs text-purple-400/60 mt-0.5 truncate">
                      {aiDiagnosis.substring(0, 60)}...
                    </p>
                  </div>
                  {showDiagnosis ? (
                    <ChevronUp className="w-4 h-4 text-purple-400/50" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-purple-400/50" />
                  )}
                </button>
              )}

              {/* AI Diagnosis Expanded */}
              {showDiagnosis && aiDiagnosis && (
                <div className="p-4 rounded-xl bg-zinc-900/50 border border-purple-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-purple-400" />
                    <span className="text-sm font-medium text-purple-400">Build Diagnosis</span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    {aiDiagnosis}
                  </p>
                  <button
                    onClick={() => setShowDiagnosis(false)}
                    className="mt-3 text-xs text-purple-400/60 hover:text-purple-400 transition-colors"
                  >
                    Collapse
                  </button>
                </div>
              )}

              {/* Links */}
              <div className="grid grid-cols-2 gap-4">
                {vercelUrl && (
                  <a
                    href={vercelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Globe className="w-5 h-5 text-emerald-400" />
                    <div>
                      <span className="text-sm font-medium text-emerald-400">Live Site</span>
                      <p className="text-xs text-emerald-400/60 truncate">{vercelUrl}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-emerald-400/50 ml-auto" />
                  </a>
                )}
                {githubUrl && (
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800 transition-colors"
                  >
                    <Github className="w-5 h-5 text-zinc-400" />
                    <div>
                      <span className="text-sm font-medium text-zinc-300">GitHub</span>
                      <p className="text-xs text-zinc-500 truncate">{githubUrl}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-zinc-500 ml-auto" />
                  </a>
                )}
              </div>

              {/* Project Info */}
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Framework</span>
                  <span className="text-white capitalize">{framework || 'Unknown'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Deploy Branch</span>
                  <span className="text-cyan-400 font-mono">{targetBranch || 'devops-deploy'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Last Webhook</span>
                  <span className="text-zinc-400">
                    {lastWebhookAt ? new Date(lastWebhookAt).toLocaleString() : 'Never'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rollback' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-zinc-400 mb-4">
                <RefreshCw className="w-4 h-4" />
                <span>Click any deployment to trigger a rollback</span>
              </div>

              {loadingDeployments ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                </div>
              ) : deployments.length > 0 ? (
                <div className="space-y-2">
                  {deployments.map((dep, idx) => (
                    <button
                      key={dep.id}
                      onClick={() => handleRollback(dep.id)}
                      disabled={rollingBack}
                      className="w-full flex items-center justify-between p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50 hover:border-cyan-500/30 hover:bg-zinc-900 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`
                          w-2 h-2 rounded-full
                          ${dep.readyState === 'READY' ? 'bg-emerald-400' :
                            dep.readyState === 'ERROR' ? 'bg-red-400' : 'bg-zinc-400'}
                        `} />
                        <div>
                          <span className="text-sm text-white">
                            Deployment #{deployments.length - idx}
                          </span>
                          <p className="text-xs text-zinc-500">
                            {new Date(dep.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      {rollingBack ? (
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 text-zinc-500" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-500">
                  <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No deployment history available</p>
                  <p className="text-xs mt-1">Vercel token required to fetch history</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'domains' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="yourdomain.com"
                  className="flex-1 bg-zinc-900/50 border border-zinc-800/50 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50"
                />
                <button
                  onClick={handleAddDomain}
                  disabled={!customDomain || addingDomain}
                  className="px-6 py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-medium text-sm hover:bg-cyan-500/30 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {addingDomain ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add
                    </>
                  )}
                </button>
              </div>

              {domainStatus && (
                <div className={`
                  p-4 rounded-xl text-sm
                  ${domainStatus.success
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                  }
                `}>
                  {domainStatus.success ? (
                    <Check className="w-4 h-4 inline mr-2" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                  )}
                  {domainStatus.message}
                </div>
              )}

              <p className="text-xs text-zinc-500">
                Enter a custom domain to link it to your Vercel project. DNS records should point to Vercel.
              </p>
            </div>
          )}

          {activeTab === 'vitals' && (
            <div className="space-y-6">
              {loadingVitals ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                </div>
              ) : webVitals ? (
                <>
                  {/* Speed Score Display */}
                  <div className="text-center p-6 rounded-xl bg-gradient-to-br from-zinc-900/50 to-zinc-800/30 border border-zinc-800/50">
                    <div className="relative w-32 h-32 mx-auto mb-4">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle
                          cx="64"
                          cy="64"
                          r="56"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          className="text-zinc-800"
                        />
                        <circle
                          cx="64"
                          cy="64"
                          r="56"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeDasharray={`${webVitals.score * 3.5} 351`}
                          strokeLinecap="round"
                          className={getSpeedLabel(webVitals.status).color}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-bold text-white">{webVitals.score}</span>
                        <span className="text-xs text-zinc-500">/100</span>
                      </div>
                    </div>
                    <div className={`text-lg font-semibold ${getSpeedLabel(webVitals.status).color}`}>
                      {getSpeedLabel(webVitals.status).emoji} {getSpeedLabel(webVitals.status).text}
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-center">
                      <Activity className="w-5 h-5 text-cyan-400 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-white">{webVitals.lcp?.toFixed(1)}s</div>
                      <div className="text-xs text-zinc-500">LCP</div>
                      <div className="text-xs text-zinc-600 mt-1">Loading</div>
                    </div>
                    <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-center">
                      <TrendingUp className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-white">{webVitals.cls?.toFixed(2)}</div>
                      <div className="text-xs text-zinc-500">CLS</div>
                      <div className="text-xs text-zinc-600 mt-1">Stability</div>
                    </div>
                    <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-center">
                      <Zap className="w-5 h-5 text-purple-400 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-white">{Math.round(webVitals.inp)}ms</div>
                      <div className="text-xs text-zinc-500">INP</div>
                      <div className="text-xs text-zinc-600 mt-1">Interactivity</div>
                    </div>
                  </div>

                  {/* Build Time */}
                  <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-zinc-400" />
                      <span className="text-sm text-zinc-300">Avg Build Time</span>
                    </div>
                    <span className="text-lg font-mono text-cyan-400">{webVitals.buildTime}s</span>
                  </div>

                  <button
                    onClick={loadWebVitals}
                    className="w-full py-3 rounded-xl border border-dashed border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors text-sm flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh Metrics
                  </button>
                </>
              ) : (
                <div className="text-center py-12">
                  <Gauge className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                  <p className="text-zinc-500 mb-4">Performance metrics require Vercel Analytics</p>
                  <button
                    onClick={loadWebVitals}
                    className="px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm hover:bg-cyan-500/20 transition-colors"
                  >
                    Load Metrics
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'edgeconfig' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm text-zinc-300">Global Variables</span>
                </div>
                <span className="text-xs text-zinc-600">Updates go live in &lt;10ms</span>
              </div>

              {/* Add New Item */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={edgeConfig.newKey}
                  onChange={(e) => setEdgeConfig({ ...edgeConfig, newKey: e.target.value })}
                  placeholder="KEY_NAME"
                  className="flex-1 bg-zinc-900/50 border border-zinc-800/50 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50"
                />
                <input
                  type="text"
                  value={edgeConfig.newValue}
                  onChange={(e) => setEdgeConfig({ ...edgeConfig, newValue: e.target.value })}
                  placeholder="value"
                  className="flex-1 bg-zinc-900/50 border border-zinc-800/50 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50"
                />
                <button
                  disabled={!edgeConfig.newKey || !edgeConfig.newValue}
                  className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-sm hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Existing Items */}
              {edgeConfig.items.length > 0 ? (
                <div className="space-y-2">
                  {edgeConfig.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/50"
                    >
                      <span className="text-sm text-cyan-400 font-mono w-40 truncate">{item.key}</span>
                      <span className="text-zinc-500">=</span>
                      <span className="flex-1 text-sm text-zinc-300 font-mono truncate">{item.value}</span>
                      <button className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-600">
                  <Settings2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No Edge Config items</p>
                  <p className="text-xs mt-1">Add global variables that update instantly</p>
                </div>
              )}

              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <p className="text-xs text-purple-400/80">
                  <Sparkles className="w-3.5 h-3.5 inline mr-1" />
                  Edge Config updates bypass the build process and propagate globally in milliseconds.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}