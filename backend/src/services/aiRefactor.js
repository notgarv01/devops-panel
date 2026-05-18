const axios = require('axios');
const path = require('path');

/**
 * AI Refactor Service - The "Brain" of Repository Surgery
 * Pure Code In / Pure Code Out surgical refactoring
 */

class AIRefactorService {
  constructor() {
    this.geminiKey = process.env.GEMINI_API_KEY;
    this.openaiKey = process.env.OPENAI_API_KEY;
    this.geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.openaiBaseUrl = process.env.AI_API_URL || 'https://api.openai.com/v1';
    this.model = process.env.AI_MODEL || 'gemini-2.0-flash';
    this.useGemini = !!(this.geminiKey);
  }

  /**
   * Pure Code In / Pure Code Out
   * Takes broken code, fixes imports, returns clean code
   */
  async getSurgicalRefactor(fileData) {
    const { code, newPath, migrationMap } = fileData;

    const hasApiKey = this.geminiKey || this.openaiKey;
    if (!hasApiKey) {
      console.log('[AIRefactor] No AI key configured, skipping refactor');
      return code;
    }

    // Detect if this is frontend or backend code
    const isFrontend = newPath.includes('/frontend/') ||
                       newPath.includes('/client/') ||
                       newPath.includes('/src/') && !newPath.includes('/backend/');

    const isBackend = newPath.includes('/backend/') ||
                      newPath.includes('/server/') ||
                      newPath.includes('/api/');

    const envFix = isFrontend
      ? 'import.meta.env.VITE_API_URL'
      : 'process.env.API_URL';

    const systemPrompt = `ACT AS: A Senior DevOps Engineer specializing in MERN stack migrations.

CONTEXT:
- File has been moved to: "${newPath}"
- Migration Map: ${JSON.stringify(migrationMap || {})}

YOUR SURGICAL TASK:
1. FIX RELATIVE PATHS: Update all 'require' or 'import' statements to point to correct locations in the new structure
2. KILL LOCALHOST URLs: Replace all hardcoded localhost URLs with:
   - Backend files: process.env.API_URL
   - Frontend files: import.meta.env.VITE_API_URL
3. FIX DB CONNECTIONS: MongoDB URIs must use process.env.MONGO_URI

STRICT RULES (Violate these and the build breaks):
- Return ONLY raw code - no markdown blocks, no explanations, no conversational text
- Do NOT wrap code in \`\`\` or ''' or any delimiter
- Do NOT say "Here is the code" or "Certainly" or "Sure"
- If no changes needed, return original code exactly as-is
- Keep all original functionality intact`;

    const userPrompt = `ORIGINAL CODE:\n${code}`;

    try {
      let refactoredCode;

      if (this.useGemini) {
        const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${this.geminiKey}`;
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: {
            maxOutputTokens: 3000,
            temperature: 0.1  // Low temp for consistent code output
          }
        }, { timeout: 45000 });

        refactoredCode = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || code;
      } else {
        const response = await axios.post(`${this.openaiBaseUrl}/chat/completions`, {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 3000,
          temperature: 0.1
        }, {
          headers: {
            'Authorization': `Bearer ${this.openaiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 45000
        });

        refactoredCode = response.data?.choices?.[0]?.message?.content || code;
      }

      // Clean response: strip any markdown formatting
      refactoredCode = this.stripMarkdown(refactoredCode);

      // Validate output is valid JavaScript
      if (!this.isValidCode(refactoredCode)) {
        console.error('[AIRefactor] AI returned invalid code, using original');
        return code;
      }

      return refactoredCode;

    } catch (error) {
      console.error('[AIRefactor] AI call failed:', error.message);
      return code;  // Fall back to original on failure
    }
  }

  /**
   * Batch refactor multiple files
   */
  async batchRefactor(files, migrationMap, logs) {
    const results = {
      refactored: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    for (const filePath of files) {
      try {
        const fs = require('fs').promises;
        const fullPath = filePath;
        const exists = await fs.access(fullPath).then(() => true).catch(() => false);

        if (!exists) {
          logs?.emit('warning', `[AIRefactor] Skip: ${filePath} not found`);
          results.skipped++;
          continue;
        }

        const code = await fs.readFile(fullPath, 'utf8');
        const newPath = filePath;

        const fixedCode = await this.getSurgicalRefactor({
          code,
          newPath,
          migrationMap
        });

        if (fixedCode !== code) {
          await fs.writeFile(fullPath, fixedCode);
          logs?.emit('info', `  Refactored: ${filePath}`);
          results.refactored++;
        } else {
          logs?.emit('info', `  No changes: ${filePath}`);
          results.skipped++;
        }
      } catch (error) {
        console.error(`[AIRefactor] Failed: ${filePath}`, error.message);
        results.failed++;
        results.errors.push(`${filePath}: ${error.message}`);
      }
    }

    console.log(`[AIRefactor] Batch complete: ${results.refactored} refactored, ${results.skipped} skipped, ${results.failed} failed`);
    return results;
  }

  /**
   * Strip markdown code blocks from AI response
   */
  stripMarkdown(code) {
    if (!code) return code;

    // Remove ```javascript, ```js, ``` at start and end
    code = code.replace(/^```(?:javascript|js)?\n?/i, '');
    code = code.replace(/\n?```$/i, '');

    // Remove any other markdown artifacts
    code = code.replace(/^```/gm, '');

    return code.trim();
  }

  /**
   * Basic validation that output looks like valid JS
   */
  isValidCode(code) {
    if (!code || typeof code !== 'string') return false;

    // Must have some basic structure
    const hasContent = code.length > 10;
    const hasNoNullBytes = !code.includes('\0');
    const looksLikeJS = /[;{}]/.test(code);  // Basic JS syntax markers

    return hasContent && hasNoNullBytes && looksLikeJS;
  }
}

// Singleton
let refactorService = null;

const createAIRefactorService = () => {
  if (!refactorService) {
    refactorService = new AIRefactorService();
  }
  return refactorService;
};

module.exports = { AIRefactorService, createAIRefactorService };