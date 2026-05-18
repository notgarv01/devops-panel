const axios = require('axios');
const fs = require('fs');
const path = require('path');

// AI Service for build diagnostics
// Supports both OpenAI and Google Gemini APIs

class AIService {
  constructor(apiKey = null) {
    // Check for Gemini first, then fall back to OpenAI
    this.geminiKey = apiKey || process.env.GEMINI_API_KEY;
    this.openaiKey = process.env.OPENAI_API_KEY;
    this.geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.openaiBaseUrl = process.env.AI_API_URL || 'https://api.openai.com/v1';
    this.model = process.env.AI_MODEL || 'gemini-2.0-flash';
    this.useGemini = !!(this.geminiKey);
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
    const apiKey = this.geminiKey;
    let url, options;

    if (endpoint === '/chat/completions') {
      // Convert OpenAI format to Gemini format
      const contents = this.convertToGeminiContents(data.messages);
      const prompt = data.messages?.[data.messages.length - 1]?.content || '';

      url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${apiKey}`;
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: data.max_tokens || 500,
            temperature: data.temperature || 0.3
          }
        },
        timeout: 30000
      };
    } else {
      url = `${this.geminiBaseUrl}${endpoint}?key=${apiKey}`;
      options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        data,
        timeout: 30000
      };
    }

    const response = await axios(url, options);
    return response.data;
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
    const hasApiKey = this.geminiKey || this.openaiKey;
    if (!hasApiKey) {
      return {
        success: false,
        error: 'AI diagnostic not configured. Set GEMINI_API_KEY or OPENAI_API_KEY in environment.'
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

      let response;
      if (this.useGemini) {
        response = await this.geminiDiagnose(userPrompt, systemPrompt);
      } else {
        response = await this.request('POST', '/chat/completions', {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 300,
          temperature: 0.2
        });
        response = response.choices[0]?.message?.content;
      }

      return {
        success: true,
        diagnosis: this.useGemini ? response : response,
        issue: this.extractIssue(this.useGemini ? response : response),
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
    const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${this.geminiKey}`;

    const response = await axios.post(url, {
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        maxOutputTokens: 300,
        temperature: 0.2
      }
    }, { timeout: 30000 });

    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'AI Limit hit. Check Vercel Dashboard.';
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

      if (this.useGemini) {
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
    const hasApiKey = this.geminiKey || this.openaiKey;
    if (!hasApiKey) {
      return {
        success: false,
        plan: null,
        error: 'AI not configured. Set GEMINI_API_KEY or OPENAI_API_KEY.'
      };
    }

    try {
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

      const userPrompt = `Repository Structure (${repoStructure.split('\n').length} files):
${repoStructure}

Packages found (${packageCount}): ${packageNames}

Generate the Master Migration Plan as STRICT JSON.`;

      let plan;
      if (this.useGemini) {
        const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${this.geminiKey}`;
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.2
          }
        }, { timeout: 45000 });

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } else {
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

    } catch (error) {
      console.error('[Architect] Omni-Architect failed:', error.message);
      return {
        success: false,
        plan: null,
        error: error.message
      };
    }
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