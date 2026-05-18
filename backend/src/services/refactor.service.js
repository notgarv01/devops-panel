const fs = require('fs').promises;
const path = require('path');
const { createAIService } = require('./ai.service');

/**
 * AI Refactor Service
 * Solves the Import Paradox: re-wires code to work in its new standardized home
 */

async function refactorMovedFiles(workDir, refactorList, migrationPlan, logs) {
  const aiService = createAIService();
  const results = {
    refactored: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  if (!refactorList || refactorList.length === 0) {
    logs?.emit('info', '[Refactor] No files to refactor');
    return results;
  }

  logs?.emit('info', `[Refactor] Processing ${refactorList.length} files...`);

  for (const filePath of refactorList) {
    try {
      const fullPath = path.join(workDir, filePath);

      // Check if file exists (it might have been moved)
      const exists = fs.existsSync(fullPath);
      if (!exists) {
        logs?.emit('warning', `[Refactor] Skip: ${filePath} not found`);
        results.skipped++;
        continue;
      }

      const content = await fs.readFile(fullPath, 'utf8');
      const originalContent = content;

      // Ask AI to fix the paths and environment variables
      logs?.emit('info', `[Refactor] Analyzing: ${filePath}`);

      const updatedCode = await callAIRefactor(aiService, content, filePath, migrationPlan);

      // Only write if changes were made
      if (updatedCode !== content) {
        await fs.writeFile(fullPath, updatedCode);
        logs?.emit('info', `  Refactored: ${filePath}`);
        results.refactored++;
      } else {
        logs?.emit('info', `  No changes needed: ${filePath}`);
        results.skipped++;
      }
    } catch (error) {
      console.error(`[Refactor] Failed: ${filePath} - ${error.message}`);
      results.failed++;
      results.errors.push(`${filePath}: ${error.message}`);
    }
  }

  console.log(`[Refactor] Complete: ${results.refactored} refactored, ${results.skipped} skipped, ${results.failed} failed`);
  return results;
}

async function callAIRefactor(aiService, code, filePath, migrationPlan) {
  const hasApiKey = aiService.geminiKey || aiService.openaiKey;

  // Determine if this is a frontend or backend file
  const isFrontend = filePath.startsWith('frontend') || filePath.includes('/frontend/') ||
                     filePath.includes('/client/') || filePath.includes('src/');
  const isBackend = filePath.startsWith('backend') || filePath.includes('/backend/') ||
                    filePath.includes('/server/');

  const envVarFix = isFrontend
    ? 'import.meta.env.VITE_API_URL'
    : 'process.env.API_URL';

  const systemPrompt = `You are a Senior Software Engineer. I have moved this file to a new location: ${filePath}

Your Task:
1. Update all relative import and require paths so they point to the correct files in the new MERN structure.
2. Replace any instances of http://localhost:3000 or other local URLs with ${envVarFix} (for backend files) or import.meta.env.VITE_API_URL (for frontend files).

Return ONLY the updated code. No explanations.`;

  const userPrompt = `Original Code:
\`\`\`javascript
${code}
\`\`\``;

  try {
    let refactoredCode;

    if (aiService.useGemini) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiService.model}:generateContent?key=${aiService.geminiKey}`;
      const response = await require('axios').post(url, {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.2
        }
      }, { timeout: 30000 });

      refactoredCode = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || code;
    } else {
      const response = await aiService.request('POST', '/chat/completions', {
        model: aiService.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 2000,
        temperature: 0.2
      });
      refactoredCode = response.choices[0]?.message?.content || code;
    }

    // Extract code from markdown if needed
    if (refactoredCode.includes('```')) {
      const match = refactoredCode.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
      if (match) {
        refactoredCode = match[1];
      }
    }

    return refactoredCode;
  } catch (error) {
    console.error('[Refactor] AI call failed:', error.message);
    // Return original on AI failure - let manual fix handle it
    return code;
  }
}

// Standalone helper: fix relative path depth when file moves deeper/shallower
function calculateNewRelativePath(oldPath, newPath, importPath) {
  const oldDir = path.dirname(oldPath);
  const newDir = path.dirname(newPath);

  // Get relative path from old location to the import target
  const relativeToOld = path.relative(oldDir, importPath);

  // Get relative path from new location using same structure
  return path.relative(newDir, importPath);
}

module.exports = {
  refactorMovedFiles,
  callAIRefactor,
  calculateNewRelativePath
};