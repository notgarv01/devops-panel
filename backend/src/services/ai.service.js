const axios = require('axios');
const fs = require('fs');
const path = require('path');

// AI Service - Hybrid Architecture
// Local AI for development, Cloud AI for production

class AIService {
  constructor(apiKey = null) {
    // Determine environment mode
    this.isProduction = process.env.NODE_ENV === 'production';
    this.isDevelopment = process.env.NODE_ENV === 'development';

    // Local AI (Ollama) - Development mode
    this.localAiUrl = process.env.LOCAL_AI_URL || 'http://localhost:11434/v1';
    this.localModel = process.env.LOCAL_MODEL || 'llama3';
    this.localApiKey = 'ollama'; // Ollama doesn't require real auth

    // Cloud AI Keys
    this.claudeKeys = [
      process.env.CLAUDE_API_KEY,
      process.env.CLAUDE_API_KEY_2,
      process.env.CLAUDE_API_KEY_3
    ].filter(k => k && k.trim());

    this.geminiKeys = [
      apiKey || process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2
    ].filter(k => k && k.trim());

    this.openaiKey = process.env.OPENAI_API_KEY;
    this.openrouterKey = process.env.OPENROUTER_API_KEY;

    // Base URLs
    this.geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.openaiBaseUrl = process.env.AI_API_URL || 'https://api.openai.com/v1';
    this.openrouterBaseUrl = 'https://openrouter.ai/api/v1';
    this.model = process.env.AI_MODEL || 'claude-3-5-sonnet-20241022';
    this.openrouterModel = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku';

    // Track current key index for rotation
    this.currentClaudeIndex = 0;
    this.currentGeminiIndex = 0;

    // Determine which API to use based on environment
    this.useLocal = false;
    this.useGemini = false;
    this.useClaude = false;
    this.useOpenRouter = false;

    if (this.isDevelopment) {
      // Development: Use local Ollama
      this.useLocal = true;
      console.log('[AI Service] Mode: DEVELOPMENT - Using local Ollama');
    } else {
      // Production: Use cloud AI
      if (this.claudeKeys.length > 0) {
        this.useClaude = true;
      } else if (this.openrouterKey) {
        this.useOpenRouter = true;
      } else if (this.geminiKeys.length > 0) {
        this.useGemini = true;
      }
      console.log('[AI Service] Mode: PRODUCTION - Using cloud AI');
    }
  }

  // Check if local AI is available
  async checkLocalHealth() {
    try {
      const response = await axios.get(this.localAiUrl.replace('/v1', '/api/tags'), { timeout: 3000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // Call local Ollama AI
  async callLocalAI(messages, options = {}) {
    try {
      const response = await axios.post(this.localAiUrl + '/chat/completions', {
        model: this.localModel,
        messages: messages,
        max_tokens: options.max_tokens || 500,
        temperature: options.temperature || 0.3
      }, {
        headers: {
          'Authorization': `Bearer ${this.localApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // Local is slower, give it more time
      });
      return response.data;
    } catch (error) {
      console.error('[AI Service] Local Ollama call failed:', error.message);
      throw error;
    }
  }

  // Fallback: Try local, then cloud if local fails (for hybrid resilience)
  async callWithHybridFallback(messages, options = {}) {
    // Try local first in development
    if (this.useLocal) {
      try {
        const isHealthy = await this.checkLocalHealth();
        if (isHealthy) {
          console.log('[AI Service] Using local Ollama...');
          return await this.callLocalAI(messages, options);
        }
        console.log('[AI Service] Local Ollama not available, falling back to cloud...');
      } catch (error) {
        console.log('[AI Service] Local failed, falling back to cloud...');
      }
    }

    // Fallback to cloud
    return await this.callCloudAI(messages, options);
  }

  // Generic cloud AI call
  async callCloudAI(messages, options = {}) {
    if (this.useClaude && this.claudeKeys.length > 0) {
      return await this.callClaude(messages, options);
    } else if (this.useOpenRouter && this.openrouterKey) {
      return await this.callOpenRouter(messages, options);
    } else if (this.useGemini && this.geminiKeys.length > 0) {
      return await this.callGemini(messages, options);
    }
    throw new Error('No cloud AI provider available');
  }

  // Claude API call
  async callClaude(messages, options = {}) {
    for (let i = 0; i < this.claudeKeys.length; i++) {
      try {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: this.model,
          max_tokens: options.max_tokens || 500,
          messages: messages
        }, {
          headers: {
            'x-api-key': this.claudeKeys[i],
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });
        return response.data;
      } catch (error) {
        if (error.response?.status === 429 || error.response?.status === 400) {
          console.log(`[AI Service] Claude key ${i + 1} hit limit, trying next...`);
          continue;
        }
        throw error;
      }
    }
    throw new Error('All Claude keys exhausted');
  }

  // OpenRouter API call
  async callOpenRouter(messages, options = {}) {
    const response = await axios.post(this.openrouterBaseUrl + '/chat/completions', {
      model: this.openrouterModel,
      messages: messages,
      max_tokens: options.max_tokens || 500,
      temperature: options.temperature || 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${this.openrouterKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
    return response.data;
  }

  // Gemini API call
  async callGemini(messages, options = {}) {
    const prompt = messages.map(m => m.content).join('\n');
    for (let i = 0; i < this.geminiKeys.length; i++) {
      try {
        const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${this.geminiKeys[i]}`;
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: options.max_tokens || 500,
            temperature: options.temperature || 0.3
          }
        }, { timeout: 30000 });
        return response.data;
      } catch (error) {
        if (error.response?.status === 429) {
          console.log(`[AI Service] Gemini key ${i + 1} hit limit, trying next...`);
          continue;
        }
        throw error;
      }
    }
    throw new Error('All Gemini keys exhausted');
  }

  // Get next Claude key (rotation)
  getNextClaudeKey() {
    if (this.claudeKeys.length === 0) return null;
    this.currentClaudeIndex = (this.currentClaudeIndex + 1) % this.claudeKeys.length;
    return this.claudeKeys[this.currentClaudeIndex];
  }

  // Get next Gemini key (rotation)
  getNextGeminiKey() {
    if (this.geminiKeys.length === 0) return null;
    this.currentGeminiIndex = (this.currentGeminiIndex + 1) % this.geminiKeys.length;
    return this.geminiKeys[this.currentGeminiIndex];
  }

  // Try API call with fallback to next key
  async callWithFallback(provider, callFn) {
    let lastError = null;

    // Try Claude keys
    if (provider === 'claude') {
      for (let i = 0; i < this.claudeKeys.length; i++) {
        try {
          const key = this.claudeKeys[i];
          const result = await callFn(key);
          return result;
        } catch (error) {
          lastError = error;
          // Check if it's a credit limit or quota error - switch to next key
          if (error.response?.status === 429 || error.response?.status === 400) {
            console.log(`[AI Service] Claude key ${i + 1} hit limit, trying next...`);
            continue;
          }
          // For auth errors, don't retry other keys
          if (error.response?.status === 401) {
            break;
          }
        }
      }
    }

    // Try Gemini keys
    if (provider === 'gemini') {
      for (let i = 0; i < this.geminiKeys.length; i++) {
        try {
          const key = this.geminiKeys[i];
          const result = await callFn(key);
          return result;
        } catch (error) {
          lastError = error;
          if (error.response?.status === 429 || error.response?.status === 400) {
            console.log(`[AI Service] Gemini key ${i + 1} hit limit, trying next...`);
            continue;
          }
          if (error.response?.status === 401) {
            break;
          }
        }
      }
    }

    throw lastError;
  }

  async request(method, endpoint, data = null, retries = 3) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (this.useGemini) {
          return await this.geminiRequest(method, endpoint, data);
        } else {
          return await this.openaiRequest(method, endpoint, data);
        }
      } catch (error) {
        lastError = error;
        // Handle rate limiting with backoff
        if (error.response?.status === 429 && attempt < retries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`[AI Service] Rate limited, waiting ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        break;
      }
    }
    console.error('[AI Service] Request failed after retries:', lastError?.message);
    throw lastError;
  }

  async geminiRequest(method, endpoint, data) {
    // Try all Gemini keys with fallback
    for (let i = 0; i < this.geminiKeys.length; i++) {
      const apiKey = this.geminiKeys[i];
      try {
        let url, options;

        if (endpoint === '/chat/completions') {
          const contents = this.convertToGeminiContents(data.messages);
          const prompt = data.messages?.[data.messages.length - 1]?.content || '';
          url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${apiKey}`;
          options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            data: {
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: data.max_tokens || 500, temperature: data.temperature || 0.3 }
            },
            timeout: 30000
          };
        } else {
          url = `${this.geminiBaseUrl}${endpoint}?key=${apiKey}`;
          options = { method, headers: { 'Content-Type': 'application/json' }, data, timeout: 30000 };
        }

        const response = await axios(url, options);
        return response.data;
      } catch (error) {
        console.log(`[Gemini] Key ${i + 1} failed: ${error.response?.status || error.message}`);
        if (i === this.geminiKeys.length - 1) throw error;
      }
    }
  }

  convertToGeminiContents(messages) {
    return messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
  }

  async openaiRequest(method, endpoint, data) {
    const url = `${this.openaiBaseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json'
      },
      data,
      timeout: 30000
    };

    const response = await axios(url, options);
    return response.data;
  }

  // Diagnose build failure from Vercel logs
  async diagnoseBuildFailure(buildLogs) {
    if (this.isDevelopment && !this.useLocal) {
      return {
        success: false,
        error: 'AI diagnostic not configured. Set LOCAL_AI_URL or switch to production mode.'
      };
    }
    if (!this.isDevelopment && this.claudeKeys.length === 0 && this.geminiKeys.length === 0 && !this.openaiKey) {
      return {
        success: false,
        error: 'AI diagnostic not configured. Set CLAUDE_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY.'
      };
    }

    try {
      // TRICK: Only take the last 25 lines to stay within TPM limit
      let logText;

      if (Array.isArray(buildLogs)) {
        // Handle array of log objects
        const messages = buildLogs.map(log => log.message || '').filter(Boolean);
        logText = messages.slice(-25).join('\n');
      } else if (typeof buildLogs === 'string') {
        // Handle string logs
        logText = buildLogs.split('\n').slice(-25).join('\n');
      } else {
        logText = 'No logs available';
      }

      // Truncate each line to 150 chars to further reduce payload
      logText = logText.split('\n').map(line => line.substring(0, 150)).join('\n');

      // Add small delay to prevent burst rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

      const systemPrompt = `You are a DevOps engineer. Briefly explain why this build failed in 2 sentences max.`;

      const userPrompt = `Build failed. Last 25 log lines:\n${logText}`;
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      let response;

      if (this.useLocal) {
        // Use hybrid fallback for local-first approach
        const result = await this.callWithHybridFallback(messages, { max_tokens: 300, temperature: 0.2 });
        response = result.choices?.[0]?.message?.content || result.text || 'Local AI response unavailable.';
      } else if (this.useClaude && this.claudeKeys.length > 0) {
        const claudeRes = await axios.post('https://api.anthropic.com/v1/messages', {
          model: this.model,
          max_tokens: 500,
          messages: messages
        }, {
          headers: {
            'x-api-key': this.claudeKeys[0],
            'anthropic-version': '2023-06-01'
          },
          timeout: 60000
        });
        response = claudeRes.data?.content?.[0]?.text || 'AI Limit hit.';
      } else if (this.useGemini && this.geminiKeys.length > 0) {
        response = await this.geminiDiagnose(userPrompt, systemPrompt);
      } else {
        response = await this.request('POST', '/chat/completions', {
          model: this.model,
          messages: messages,
          max_tokens: 300,
          temperature: 0.2
        });
        response = response.choices[0]?.message?.content;
      }

      return {
        success: true,
        diagnosis: response,
        issue: this.extractIssue(response),
        suggestion: 'Check Vercel dashboard for full logs',
        confidence: 'medium'
      };

    } catch (error) {
      console.error('[AI Service] Diagnosis failed:', error.message);
      return {
        success: false,
        error: 'AI Limit hit. Check Vercel Dashboard for raw logs.'
      };
    }
  }

  async geminiDiagnose(userPrompt, systemPrompt) {
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    for (let i = 0; i < this.geminiKeys.length; i++) {
      try {
        const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${this.geminiKeys[i]}`;
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.2
          }
        }, { timeout: 30000 });
        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'AI Limit hit. Check Vercel Dashboard.';
      } catch (error) {
        console.log(`[Gemini] Diagnose failed, trying next key...`);
        if (i === this.geminiKeys.length - 1) throw error;
      }
    }
  }

  // Phase 2: AI-Assisted Branch Surgery
  // Generates specific surgery instructions based on audit map
  async performBranchSurgery(audit) {
    const hasApiKey = this.geminiKey || this.openaiKey;
    if (!hasApiKey) {
      return {
        success: false,
        instructions: null,
        error: 'AI not configured. Set GEMINI_API_KEY or OPENAI_API_KEY.'
      };
    }

    try {
      const auditSummary = JSON.stringify(audit, null, 2);

      const systemPrompt = `You are a DevOps surgeon specializing in preparing MERN apps for Vercel deployment.
Analyze the audit map and provide EXACT surgical instructions as a JSON array.
Each instruction must have: { "file": "path", "change": "description", "find": "code to find", "replace": "code to replace" }

Rules:
1. Always ensure vite.config.js has base: '/'
2. Replace localhost URLs with process.env.API_URL (backend) or import.meta.env.VITE_API_URL (frontend)
3. Ensure vercel.json outputDirectory matches the audit outDir
4. Keep instructions minimal and precise - max 5 instructions`;

      const userPrompt = `Based on this audit map, generate surgery instructions:
${auditSummary}

Respond ONLY with valid JSON array of instructions. Example format:
[
  { "file": "frontend/vite.config.js", "change": "Set base to /", "find": "base: '/app'", "replace": "base: '/'" },
  { "file": "frontend/src/config/api.js", "change": "Use VITE_API_URL", "find": "http://localhost:5000", "replace": "import.meta.env.VITE_API_URL" }
]`;

      let surgeryInstructions;

      if (this.useClaude) {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: this.model,
          max_tokens: 800,
          messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }]
        }, {
          headers: { 'x-api-key': this.claudeKey, 'anthropic-version': '2023-06-01' },
          timeout: 60000
        });
        const text = response.data?.content?.[0]?.text || '[]';
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        surgeryInstructions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } else if (this.useGemini) {
        const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${this.geminiKey}`;
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.2
          }
        }, { timeout: 30000 });

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        // Try to extract JSON from response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        surgeryInstructions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } else {
        const response = await this.request('POST', '/chat/completions', {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 500,
          temperature: 0.2
        });
        const text = response.choices[0]?.message?.content;
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        surgeryInstructions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      }

      console.log(`[AI Surgery] Generated ${surgeryInstructions.length} instructions`);

      return {
        success: true,
        instructions: surgeryInstructions,
        count: surgeryInstructions.length
      };

    } catch (error) {
      console.error('[AI Surgery] Failed:', error.message);
      return {
        success: false,
        instructions: null,
        error: error.message
      };
    }
  }

  // Execute surgery instructions on the codebase
  async executeSurgery(workDir, instructions, logs) {
    const results = {
      applied: 0,
      failed: 0,
      errors: []
    };

    if (!instructions || instructions.length === 0) {
      return results;
    }

    for (const instruction of instructions) {
      try {
        const filePath = path.join(workDir, instruction.file);
        const exists = fs.existsSync(filePath);

        if (!exists) {
          logs?.emit('warning', `Surgery skip: ${instruction.file} not found`);
          results.failed++;
          continue;
        }

        let content = await fs.promises.readFile(filePath, 'utf8');
        const original = content;

        if (instruction.find && instruction.replace) {
          content = content.replace(instruction.find, instruction.replace);
        }

        if (content !== original) {
          await fs.promises.writeFile(filePath, content);
          logs?.emit('info', `Surgery applied: ${instruction.file} - ${instruction.change}`);
          results.applied++;
        }
      } catch (error) {
        console.error(`[Surgery] Error on ${instruction.file}:`, error.message);
        results.failed++;
        results.errors.push(`${instruction.file}: ${error.message}`);
      }
    }

    return results;
  }

  // ===== STEP 2: OMNI-ARCHITECT SYSTEM PROMPT =====
  // The central nervous system - drives the AI as a Cloud Architect
  async generateMigrationPlan(repoStructure, packages = []) {
    // Check if any API key is available
    const hasLocal = await this.checkLocalHealth();
    const hasCloudKeys = this.claudeKeys.length > 0 || this.geminiKeys.length > 0 || !!this.openaiKey || !!this.openrouterKey;

    if (!hasLocal && !hasCloudKeys) {
      return {
        success: false,
        plan: null,
        error: 'AI not configured. Set LOCAL_AI_URL, or cloud API keys.'
      };
    }

    const packageNames = packages.map(p => p.name || p.path).join(', ');
    const packageCount = packages.length;

    const systemPrompt = `ACT AS: A Senior DevOps Architect & Full-Stack Automation Engineer.

CONTEXT:
I have a MERN repository that is 'unstructured' (folders are messy, mixed, or non-standard). I need you to generate a 'Master Migration Plan' to standardize this into a Vercel-compatible MERN Mono-repo.

TARGET ARCHITECTURE:
- /frontend: All UI code (React/Vite), assets, and the UI-specific package.json.
- /backend: All Server code (Express), controllers, models, and the Server-specific package.json.
- /api: The Vercel Serverless entry point folder.

YOUR TASK:
1. ANALYZE the provided file tree.
2. GENERATE a JSON Migration Map.
3. IDENTIFY every file that will need internal 'import/require' path updates because its depth has changed.
4. DETECT if the project has a single root package.json or separate ones.

STRICT JSON OUTPUT FORMAT:
{
  "project_type": "MERN",
  "migrations": [
    { "from": "path/to/old_file.js", "to": "frontend/src/new_file.js" }
  ],
  "refactor_list": [
    "backend/server.js",
    "frontend/src/api/config.js"
  ],
  "package_strategy": "SPLIT_REQUIRED" | "ALREADY_SEPARATE",
  "vercel_build_command": "cd frontend && npm install && npm run build",
  "vercel_output_dir": "frontend/dist"
}

RULES:
- Do not explain yourself.
- Do not include markdown code blocks.
- If a file is shared (like a .env), move it to /backend.
- Ensure 'index.html' is moved to the root of /frontend.`;

    // Truncate repo structure to prevent AI JSON parsing errors
    const fileLines = repoStructure.split('\n');
    const truncatedFiles = fileLines.length > 35 ? fileLines.slice(0, 35).join('\n') + '\n... (truncated)' : repoStructure;

    const userPrompt = `Repository Structure (${fileLines.length} files, showing first 35):
${truncatedFiles}

Packages found (${packageCount}): ${packageNames}

Generate the Master Migration Plan as STRICT JSON.`;

    let plan;
    let lastError = null;

    // Try Local AI first (if development mode)
    if (this.isDevelopment && hasLocal) {
      try {
        console.log('[Architect] Trying local Ollama...');
        const response = await this.callLocalAI([
          { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
        ], { max_tokens: 1500, temperature: 0.2 });

        const text = response.choices?.[0]?.message?.content || '{}';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          plan = JSON.parse(jsonMatch[0]);
          console.log('[Architect] Local Ollama succeeded!');
        }
      } catch (localError) {
        console.log('[Architect] Local Ollama failed:', localError.message);
      }
    }

    // Try Claude keys with fallback (if local didn't work or production mode)
    if (!plan && this.claudeKeys.length > 0) {
      for (let keyIndex = 0; keyIndex < this.claudeKeys.length; keyIndex++) {
        const key = this.claudeKeys[keyIndex];
        try {
          console.log(`[Architect] Trying Claude API (key ${keyIndex + 1}/${this.claudeKeys.length})...`);

          const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: this.model,
            max_tokens: 1500,
            messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }]
          }, {
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json'
            },
            timeout: 60000
          });

          const text = response.data?.content?.[0]?.text || '{}';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
          console.log(`[Architect] Claude key ${keyIndex + 1} succeeded!`);
          break;
        } catch (claudeError) {
          lastError = claudeError;
          console.log(`[Architect] Claude key ${keyIndex + 1} failed: ${claudeError.response?.status || claudeError.message}`);

          // If auth error, don't try other keys
          if (claudeError.response?.status === 401) {
            break;
          }
          // Try next key
        }
      }
    }

    // Try Gemini keys if Claude failed
    if (!plan && this.geminiKeys.length > 0) {
      for (let keyIndex = 0; keyIndex < this.geminiKeys.length; keyIndex++) {
        const key = this.geminiKeys[keyIndex];
        try {
          console.log(`[Architect] Trying Gemini API (key ${keyIndex + 1}/${this.geminiKeys.length})...`);

          const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${key}`;
          const response = await axios.post(url, {
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { maxOutputTokens: 1000, temperature: 0.2 }
          }, { timeout: 45000 });

          const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
          console.log(`[Architect] Gemini key ${keyIndex + 1} succeeded!`);
          break;
        } catch (geminiError) {
          lastError = geminiError;
          console.log(`[Architect] Gemini key ${keyIndex + 1} failed: ${geminiError.response?.status || geminiError.message}`);

          if (geminiError.response?.status === 401) {
            break;
          }
        }
      }
    }

    // Try OpenRouter as fallback
    if (!plan && this.openrouterKey) {
      try {
        console.log('[Architect] Trying OpenRouter API...');
        const response = await axios.post(`${this.openrouterBaseUrl}/chat/completions`, {
          model: this.openrouterModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1000,
          temperature: 0.2
        }, {
          headers: {
            'Authorization': `Bearer ${this.openrouterKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });
        const text = response.data?.choices?.[0]?.message?.content || '{}';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch (openrouterError) {
        lastError = openrouterError;
        console.log(`[Architect] OpenRouter failed: ${openrouterError.message}`);
      }
    }

    // Try OpenAI as last resort
    if (!plan && this.openaiKey) {
      try {
        console.log('[Architect] Trying OpenAI API...');
        const response = await this.request('POST', '/chat/completions', {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1000,
          temperature: 0.2
        });
        const text = response.choices[0]?.message?.content;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch (openaiError) {
        lastError = openaiError;
        console.log(`[Architect] OpenAI failed: ${openaiError.message}`);
      }
    }

    if (!plan) {
      console.error('[Architect] All AI providers failed:', lastError?.message);
      return {
        success: false,
        plan: null,
        error: `AI unavailable: ${lastError?.message}`
      };
    }

    // Normalize plan fields to match expected format
    if (plan.migrations && !plan.moves) {
      plan.moves = plan.migrations;
    }
    if (plan.refactor_list && !plan.refactorFiles) {
      plan.refactorFiles = plan.refactor_list;
    }
    if (plan.vercel_output_dir && !plan.outputDir) {
      plan.outputDir = plan.vercel_output_dir;
    }
    if (plan.vercel_build_command && !plan.buildCommand) {
      plan.buildCommand = plan.vercel_build_command;
    }

    console.log(`[Architect] Omni-Architect MigrationPlan generated:`);
    console.log(`  Migrations: ${plan.moves?.length || 0}`);
    console.log(`  Refactor: ${plan.refactorFiles?.length || 0}`);
    console.log(`  Package Strategy: ${plan.package_strategy}`);
    console.log(`  Output: ${plan.outputDir}`);

    return {
      success: true,
      plan: plan,
      movesCount: plan.moves?.length || 0
    };
  }

  // ===== STEP 3: PHYSICAL MIGRATION (The Mover) =====
  async executeMigrationPlan(workDir, plan, logs) {
    const results = {
      moved: 0,
      refactored: 0,
      failed: 0,
      errors: []
    };

    if (!plan) {
      return results;
    }

    try {
      // Execute file moves (PHYSICAL RELOCATION, not copy)
      if (plan.moves && plan.moves.length > 0) {
        logs?.emit('info', `Executing ${plan.moves.length} file moves...`);

        for (const move of plan.moves) {
          try {
            const fromPath = path.join(workDir, move.from);
            const toPath = path.join(workDir, move.to);

            // Skip if source and destination are the same (file already in place)
            if (fromPath === toPath) {
              logs?.emit('info', `  Skip (in place): ${move.from}`);
              continue;
            }

            // Check if source exists
            if (!fs.existsSync(fromPath)) {
              logs?.emit('warning', `  Skip: ${move.from} not found`);
              results.failed++;
              continue;
            }

            // Ensure destination directory exists
            const toDir = path.dirname(toPath);
            await fs.promises.mkdir(toDir, { recursive: true });

            // PHYSICAL MOVE: rename() moves the file, doesn't copy
            await fs.promises.rename(fromPath, toPath);

            logs?.emit('info', `  Moved: ${move.from} → ${move.to}`);
            results.moved++;
          } catch (error) {
            console.error(`[Migration] Move failed: ${move.from} → ${move.to}`);
            results.failed++;
            results.errors.push(`${move.from}: ${error.message}`);
          }
        }
      }

      // Refactor files (remove app.listen, etc.)
      if (plan.refactorFiles && plan.refactorFiles.length > 0) {
        logs?.emit('info', `Refactoring ${plan.refactorFiles.length} files...`);

        for (const file of plan.refactorFiles) {
          try {
            const filePath = path.join(workDir, file);
            let content = await fs.promises.readFile(filePath, 'utf8');

            // Remove app.listen lines
            content = content.replace(/app\.listen\s*\([^)]*\);?/g, '');
            content = content.replace(/server\.listen\s*\([^)]*\);?/g, '');

            await fs.promises.writeFile(filePath, content);
            logs?.emit('info', `  Refactored: ${file}`);
            results.refactored++;
          } catch (error) {
            console.error(`[Migration] Refactor failed: ${file}`);
            results.failed++;
          }
        }
      }

      console.log(`[Architect] Migration complete: ${results.moved} moved, ${results.refactored} refactored, ${results.failed} failed`);

    } catch (error) {
      console.error('[Architect] Migration execution failed:', error.message);
    }

    return results;
  }

  extractIssue(diagnosis) {
    const lines = diagnosis.split('\n');
    return lines[0] || 'Build failed';
  }

  extractSuggestion(diagnosis) {
    const lines = diagnosis.split('\n');
    return lines.slice(1).join(' ').trim() || 'Check Vercel logs for details';
  }

  formatLogs(logs) {
    if (!logs || logs.length === 0) {
      return 'No logs provided';
    }

    // Sanitize: remove non-printable characters that cause 400 errors
    const sanitized = logs.map(log => {
      const message = (log.message || '').substring(0, 200);
      // Keep only printable ASCII characters
      return message.replace(/[^\x20-\x7E\n]/g, '');
    }).filter(msg => msg.trim());

    // Take last 20 lines to avoid rate limits
    const recentLogs = sanitized.slice(-20);
    return recentLogs.map(log => `[info] ${log}`).join('\n');
  }
}

// Create singleton instance
let aiService = null;

const createAIService = (apiKey = null) => {
  if (!aiService) {
    aiService = new AIService(apiKey);
  }
  return aiService;
};

module.exports = { AIService, createAIService };