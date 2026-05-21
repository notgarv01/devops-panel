/**
 * Unified AI Service - Hybrid Architecture with Real Local AI
 *
 * Development: Uses Ollama (qwen2.5-coder:7b) - free, no rate limits, works offline
 * Production: Uses cloud AI via OpenRouter (Claude) for portfolio demos
 */

const OpenAI = require('openai');
const axios = require('axios');
const path = require('path');

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// Configuration
const localAiUrl = process.env.LOCAL_AI_URL || 'http://localhost:11434/v1';
const localModel = process.env.LOCAL_MODEL || 'qwen2.5-coder:7b';
const openrouterKey = process.env.OPENROUTER_API_KEY;
const openrouterModel = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku';

// Initialize AI Client
let aiClient;
let activeModel;

if (isProduction) {
  // Production: Use cloud AI via OpenRouter
  console.log('🚀 Panel is using CLOUD AI (OpenRouter Mode)');
  aiClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openrouterKey,
  });
  activeModel = openrouterModel;
} else {
  // Development: Use local Ollama
  console.log('💻 Panel is using LOCAL AI (Ollama Mode)');
  aiClient = new OpenAI({
    baseURL: localAiUrl,
    apiKey: 'ollama', // Ollama doesn't require real auth
  });
  activeModel = localModel;
}

// Export for use across the application
module.exports = { aiClient, activeModel };

/**
 * 💻 REAL LOCAL AI: Generate migration plan using Ollama
 */
async function generateMigrationPlan(repoTree) {
  if (!isProduction) {
    // DEVELOPMENT MODE: Use local Ollama AI
    console.log('💻 [Local AI] Generating migration plan with qwen2.5-coder:7b...');
    try {
      const response = await aiClient.chat.completions.create({
        model: activeModel,
        messages: [
          {
            role: 'system',
            content: `You are a DevOps Architect analyzing MERN stack repositories for Vercel deployment.

REPO STRUCTURE RULES:
- Frontend code is in "frontend/" folder
- Backend code is in "backend/" folder
- Backend entry is "backend/server.js" (not in backend/src/)
- Backend Express app is at "backend/src/app.js"
- Images/assets should stay in frontend/public/

IMPORTANT: Only generate file moves if files are in WRONG locations. Common valid moves:
- Moving server.js to backend/src/server.js (if it needs restructuring)
- Moving public assets to frontend/src/assets/ (optional optimization)

If no moves needed, return empty moves array: {"moves": [], ...}

Return ONLY raw JSON object with no markdown formatting.`
          },
          {
            role: 'user',
            content: `Analyze this repository structure and generate a migration plan:\n${repoTree}`
          }
        ],
        max_tokens: 800,
        temperature: 0.2
      });

      const content = response.choices[0].message.content;
      try {
        return JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : getDefaultMigrationPlan();
      }
    } catch (error) {
      console.error('❌ Local AI failed:', error.message);
      return getDefaultMigrationPlan();
    }
  }

  // PRODUCTION MODE: Use cloud AI via OpenRouter
  console.log('☁️ [Cloud AI] Generating migration plan...');
  try {
    const response = await aiClient.chat.completions.create({
      model: activeModel,
      messages: [
        {
          role: 'system',
          content: `You are a DevOps Architect. Analyze this repository structure and generate a migration plan for standardizing MERN stack deployment. Return ONLY raw JSON object with no markdown formatting: {"moves": [{"from": "src", "to": "dest"}], "refactorFiles": ["file.js"], "outputDir": "dist", "buildCommand": "npm run build"}`
        },
        {
          role: 'user',
          content: `Analyze this repository structure:\n${repoTree}`
        }
      ],
      max_tokens: 800,
      temperature: 0.2
    });

    const content = response.choices[0].message.content;
    try {
      return JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }
  } catch (error) {
    console.error('❌ Cloud AI failed:', error.message);
    throw error;
  }
}

/**
 * 💻 REAL LOCAL AI: Analyze audit map for surgery
 */
async function performBranchSurgery(audit) {
  // DEVELOPMENT MODE: Use local Ollama AI
  if (!isProduction) {
    console.log('💻 [Local AI] Generating surgical instructions...');
    try {
      const response = await aiClient.chat.completions.create({
        model: activeModel,
        messages: [
          {
            role: 'system',
            content: `You are a DevOps surgeon. Analyze the audit and return JSON array of surgical instructions with: file, change, find, replace. Return ONLY raw JSON array.`
          },
          {
            role: 'user',
            content: `Analyze this audit map and return JSON array of surgical fixes needed:\n${JSON.stringify(audit, null, 2)}`
          }
        ],
        max_tokens: 800,
        temperature: 0.2
      });

      const text = response.choices[0].message.content;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : getDefaultSurgeryInstructions();
    } catch (error) {
      console.error('❌ Local AI surgery failed:', error.message);
      return getDefaultSurgeryInstructions();
    }
  }

  // PRODUCTION MODE: Use cloud AI
  console.log('☁️ [Cloud AI] Generating surgical instructions...');
  try {
    const response = await aiClient.chat.completions.create({
      model: activeModel,
      messages: [
        {
          role: 'system',
          content: `You are a DevOps surgeon. Analyze the audit and return JSON array of instructions with: file, change, find, replace`
        },
        {
          role: 'user',
          content: `Audit map:\n${JSON.stringify(audit, null, 2)}`
        }
      ],
      max_tokens: 800,
      temperature: 0.2
    });

    const text = response.choices[0].message.content;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (error) {
    console.error('❌ Cloud AI surgery failed:', error.message);
    return [];
  }
}

/**
 * Diagnose build failures - uses cloud AI only (not mocked)
 */
async function diagnoseBuildFailure(buildLogs) {
  if (!isProduction) {
    // Local mode: skip diagnosis or return basic response
    return {
      success: true,
      diagnosis: 'Local build test - AI diagnosis not required',
      issue: 'N/A',
      suggestion: 'Check build logs manually'
    };
  }

  try {
    let logText;
    if (Array.isArray(buildLogs)) {
      logText = buildLogs.map(log => log.message || '').filter(Boolean).slice(-25).join('\n');
    } else if (typeof buildLogs === 'string') {
      logText = buildLogs.split('\n').slice(-25).join('\n');
    } else {
      logText = 'No logs available';
    }

    const response = await aiClient.chat.completions.create({
      model: activeModel,
      messages: [
        { role: 'system', content: 'You are a DevOps engineer. Briefly explain why this build failed in 2 sentences max.' },
        { role: 'user', content: `Build failed. Last 25 log lines:\n${logText}` }
      ],
      max_tokens: 300,
      temperature: 0.2
    });

    const diagnosis = response.choices[0].message.content;
    return {
      success: true,
      diagnosis: diagnosis,
      issue: diagnosis.split('\n')[0] || 'Build failed',
      suggestion: 'Check dashboard for full logs'
    };
  } catch (error) {
    console.error('❌ diagnoseBuildFailure failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Perform code refactoring - uses cloud AI only (not mocked)
 */
async function getSurgicalRefactor(fileData) {
  const { code, newPath, migrationMap } = fileData;

  const isFrontend = newPath.includes('/frontend/') || newPath.includes('/client/');
  const isBackend = newPath.includes('/backend/') || newPath.includes('/server/');
  const envFix = isFrontend ? 'import.meta.env.VITE_API_URL' : 'process.env.API_URL';

  const systemPrompt = `ACT AS: A Senior DevOps Engineer specializing in MERN stack migrations.

CONTEXT:
- File has been moved to: "${newPath}"
- Migration Map: ${JSON.stringify(migrationMap || {})}

YOUR SURGICAL TASK:
1. FIX RELATIVE PATHS: Update all 'require' or 'import' statements
2. KILL LOCALHOST URLs: Replace all hardcoded localhost URLs with: ${envFix}
3. FIX DB CONNECTIONS: MongoDB URIs must use process.env.MONGO_URI

STRICT RULES:
- Return ONLY raw code - no markdown blocks, no explanations
- If no changes needed, return original code exactly as-is`;

  // In development, skip AI refactoring and return original code
  if (!isProduction) {
    return code;
  }

  try {
    const response = await aiClient.chat.completions.create({
      model: activeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `ORIGINAL CODE:\n${code}` }
      ],
      max_tokens: 3000,
      temperature: 0.1
    });

    let refactoredCode = response.choices[0].message.content;

    // Clean markdown artifacts
    refactoredCode = refactoredCode.replace(/^```(?:javascript|js)?\n?/i, '');
    refactoredCode = refactoredCode.replace(/\n?```$/i, '');
    refactoredCode = refactoredCode.trim();

    // Validate output
    if (!refactoredCode || refactoredCode.length < 10 || !/[;{}]/.test(refactoredCode)) {
      console.log('[AI Refactor] Invalid response, using original code');
      return code;
    }

    return refactoredCode;
  } catch (error) {
    console.error('❌ getSurgicalRefactor failed:', error.message);
    return code;
  }
}

/**
 * Health check for AI service
 */
async function checkHealth() {
  if (isProduction) {
    return !!aiClient;
  }
  // Local mode: check if Ollama is responding
  try {
    const response = await axios.get(localAiUrl.replace('/v1', '/api/tags'), { timeout: 3000 });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Default fallback migration plan for gupta-sales-devops
 */
function getDefaultMigrationPlan() {
  return {
    moves: [
      { from: 'backend/server.js', to: 'backend/src/server.js' },
      { from: 'frontend/public/ProductImages', to: 'frontend/src/assets/ProductImages' }
    ],
    refactorFiles: ['backend/src/server.js', 'backend/src/index.js'],
    outputDir: 'frontend/dist',
    buildCommand: 'cd frontend && npm install && npm run build',
    package_strategy: 'ALREADY_SEPARATE'
  };
}

/**
 * Default fallback surgery instructions
 */
function getDefaultSurgeryInstructions() {
  return [
    { file: 'frontend/vite.config.js', change: 'Fix base path', find: "base: '/app'", replace: "base: '/'" }
  ];
}

module.exports = {
  aiClient,
  activeModel,
  generateMigrationPlan,
  diagnoseBuildFailure,
  getSurgicalRefactor,
  performBranchSurgery,
  checkHealth
};