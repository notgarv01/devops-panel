import { useState } from 'react';
import { Plus, Trash2, Key, Eye, EyeOff, Copy, Check, Clipboard } from 'lucide-react';

export default function EnvManager({ envVars = [], onChange, readOnly = false }) {
  const [showValues, setShowValues] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [envPasteText, setEnvPasteText] = useState('');

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

  const handleAdd = () => {
    if (readOnly) return;
    onChange([...envVars, { key: '', value: '', type: 'secret' }]);
  };

  const handleRemove = (index) => {
    if (readOnly) return;
    onChange(envVars.filter((_, i) => i !== index));
  };

  const handleChange = (index, field, value) => {
    if (readOnly) return;
    const updated = [...envVars];
    updated[index][field] = field === 'key' ? value.toUpperCase() : value;
    onChange(updated);
  };

  const handlePasteInput = (text) => {
    setEnvPasteText(text);
    const lines = text.split('\n').filter(l => l.includes('='));
    if (lines.length > 1) {
      const parsed = parseEnvText(text);
      if (parsed.length > 0) {
        const currentFilled = envVars.filter(e => e.key && e.value);
        const newOnes = parsed.filter(p => !currentFilled.some(c => c.key === p.key));
        onChange([...currentFilled, ...newOnes]);
        setEnvPasteText('');
      }
    }
  };

  const copyAsEnvFormat = (env) => {
    navigator.clipboard.writeText(`${env.key}=${env.value}`);
    setCopiedKey(env.key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const commonEnvVars = [
    { key: 'MONGO_URI', description: 'MongoDB connection string' },
    { key: 'JWT_SECRET', description: 'JWT signing secret' },
    { key: 'STRIPE_KEY', description: 'Stripe API key' },
    { key: 'SENDGRID_KEY', description: 'SendGrid API key' },
    { key: 'AWS_ACCESS_KEY', description: 'AWS access key' },
    { key: 'PORT', description: 'Server port (default: 3000)' },
  ];

  return (
    <div className="bg-[#0F0F0F] border border-zinc-800 rounded-2xl p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-zinc-800">
            <Key className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-300">Environment Variables</h3>
            <p className="text-xs text-zinc-600">{envVars.filter(e => e.key).length} configured</p>
          </div>
        </div>

        <button
          onClick={() => setShowValues(!showValues)}
          className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded hover:bg-zinc-800 transition-colors"
          title={showValues ? 'Hide values' : 'Show values'}
        >
          {showValues ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {/* Paste Area */}
      {!readOnly && (
        <div className="mb-4">
          <div className="relative">
            <textarea
              value={envPasteText}
              onChange={(e) => handlePasteInput(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                setTimeout(() => handlePasteInput(pasted), 0);
              }}
              placeholder="Paste KEY=value pairs (one per line)"
              className="w-full h-16 bg-zinc-900/50 border border-dashed border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-400 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-none"
            />
            <Clipboard className="absolute right-3 top-3 w-4 h-4 text-zinc-600" />
          </div>
          <p className="text-xs text-zinc-600 mt-1">Paste multiple KEY=value pairs at once</p>
        </div>
      )}

      {/* Divider */}
      {envVars.length > 0 && !readOnly && (
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-xs text-zinc-700">or add individually</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>
      )}

      {/* Env Vars List */}
      <div className="space-y-2">
        {envVars.map((env, index) => (
          <div key={index} className="group flex flex-col sm:flex-row gap-2 sm:items-center p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800/50 hover:border-zinc-700 transition-colors">
            {/* Key */}
            <input
              type="text"
              value={env.key}
              onChange={(e) => handleChange(index, 'key', e.target.value)}
              placeholder="KEY"
              disabled={readOnly}
              className="w-full sm:w-28 bg-transparent border-none text-xs font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none disabled:cursor-not-allowed uppercase"
            />

            <span className="hidden sm:inline text-zinc-700 text-xs">=</span>

            {/* Value */}
            <input
              type={showValues ? 'text' : 'password'}
              value={env.value}
              onChange={(e) => handleChange(index, 'value', e.target.value)}
              placeholder="value"
              disabled={readOnly}
              className="w-full sm:flex-1 bg-transparent border-none text-xs font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none disabled:cursor-not-allowed"
            />

            {/* Actions */}
            <div className="flex items-center gap-1 self-end sm:self-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => copyAsEnvFormat(env)}
                className="p-1 text-zinc-600 hover:text-zinc-400 rounded"
                title="Copy"
              >
                {copiedKey === env.key ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>

              {!readOnly && (
                <button
                  onClick={() => handleRemove(index)}
                  className="p-1 text-zinc-600 hover:text-red-400 rounded"
                  title="Remove"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Button */}
      {!readOnly && (
        <button
          onClick={handleAdd}
          className="mt-3 w-full py-2 rounded-lg border border-dashed border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400 transition-colors flex items-center justify-center gap-1.5 text-xs"
        >
          <Plus className="w-3 h-3" />
          Add Variable
        </button>
      )}

      {/* Quick Add */}
      {!readOnly && envVars.filter(e => e.key).length === 0 && (
        <div className="mt-4">
          <p className="text-xs text-zinc-700 mb-2">Quick add:</p>
          <div className="flex flex-wrap gap-1.5">
            {commonEnvVars.slice(0, 4).map((common) => (
              <button
                key={common.key}
                onClick={() => {
                  if (!envVars.find(e => e.key === common.key)) {
                    onChange([...envVars, { key: common.key, value: '', type: 'secret' }]);
                  }
                }}
                className="px-2 py-1 text-xs rounded-md bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
              >
                {common.key}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
