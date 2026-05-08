const axios = require('axios');

// AI Service for build diagnostics
// Supports OpenAI-compatible APIs (OpenAI, Anthropic via proxy, etc.)

class AIService {
  constructor(apiKey = null) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = process.env.AI_API_URL || 'https://api.openai.com/v1';
    this.model = process.env.AI_MODEL || 'gpt-4o-mini';
  }

  async request(method, endpoint, data = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await axios(url, options);
      return response.data;
    } catch (error) {
      console.error('[AI Service] Request failed:', error.message);
      throw error;
    }
  }

  // Diagnose build failure from Vercel logs
  async diagnoseBuildFailure(buildLogs) {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'AI diagnostic not configured. Set OPENAI_API_KEY in environment.'
      };
    }

    try {
      // Format logs for analysis
      const logText = this.formatLogs(buildLogs);

      const systemPrompt = `You are a DevOps engineer specializing in debugging build failures.
When given Vercel build logs, identify the root cause and provide a clear, actionable fix.
Keep responses concise (2-3 sentences max).`;

      const userPrompt = `Analyze these Vercel build logs and identify the issue:

${logText}

If there's an error, explain what went wrong and what the user should do to fix it.
If there's no clear error, say "No obvious issue found in the logs."`;

      const response = await this.request('POST', '/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.3
      });

      const diagnosis = response.choices[0]?.message?.content || 'No diagnosis available';

      // Extract key information
      const { issue, suggestion } = this.parseDiagnosis(diagnosis);

      return {
        success: true,
        diagnosis,
        issue,
        suggestion,
        confidence: response.usage?.total_tokens > 100 ? 'high' : 'medium'
      };

    } catch (error) {
      console.error('[AI Service] Diagnosis failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Format build logs for AI consumption
  formatLogs(logs) {
    if (!logs || logs.length === 0) {
      return 'No logs provided';
    }

    // Take last 100 lines of logs (most relevant for failures)
    const recentLogs = logs.slice(-100);

    return recentLogs.map(log => {
      const timestamp = log.timestamp || new Date().toISOString();
      const level = log.level || 'info';
      const message = log.message || '';

      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }).join('\n');
  }

  // Parse diagnosis into structured format
  parseDiagnosis(diagnosis) {
    // Try to extract key information from diagnosis
    const lines = diagnosis.split('\n').filter(l => l.trim());

    let issue = null;
    let suggestion = null;

    // Look for common patterns
    const issuePatterns = [
      /(?:missing|not found|not installed|failed to find)(?: package)?:? (.+)/i,
      /error[:\s]+(.+)/i,
      /failed[:\s]+(.+)/i,
      /(?:package|module|dependency) (.+?) (?:is|not|doesn't)/i
    ];

    const suggestionPatterns = [
      /run[:\s]+(.+)/i,
      /install[:\s]+(.+)/i,
      /fix[:\s]+(.+)/i,
      /(?:add|remove|update|change) (.+)/i
    ];

    for (const pattern of issuePatterns) {
      const match = diagnosis.match(pattern);
      if (match) {
        issue = match[1] || match[0];
        break;
      }
    }

    for (const pattern of suggestionPatterns) {
      const match = diagnosis.match(pattern);
      if (match) {
        suggestion = match[1] || match[0];
        break;
      }
    }

    return { issue, suggestion };
  }

  // Generate deployment summary
  async generateDeploymentSummary(result) {
    if (!this.apiKey) {
      return null;
    }

    try {
      const { project, deployment, duration, status } = result;

      const userPrompt = `Write a brief (1-2 sentences) summary of this deployment:

Project: ${project}
Status: ${status}
URL: ${deployment}
Duration: ${duration} seconds

Format as: [Emoji] Project is [status]. [One sentence about what happened].`;

      const response = await this.request('POST', '/chat/completions', {
        model: this.model,
        messages: [
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 100,
        temperature: 0.7
      });

      return response.choices[0]?.message?.content;

    } catch (error) {
      console.error('[AI Service] Summary generation failed:', error.message);
      return null;
    }
  }

  // Check if AI is configured
  isConfigured() {
    return !!this.apiKey;
  }
}

// Parse Vercel build errors from log events
const parseBuildError = (events) => {
  const errors = [];
  const warnings = [];

  if (!events || !Array.isArray(events)) {
    return { errors, warnings };
  }

  for (const event of events) {
    const payload = event.payload || {};

    // Look for error messages
    if (event.type === 'error' || payload.level === 'error') {
      errors.push({
        message: payload.message || payload.text || 'Unknown error',
        file: payload.file || null,
        line: payload.line || null,
        column: payload.column || null,
        stack: payload.stack || null
      });
    }

    // Look for warnings
    if (event.type === 'warning' || payload.level === 'warning') {
      warnings.push({
        message: payload.message || payload.text,
        file: payload.file || null
      });
    }

    // Look for build command output
    if (payload.type === 'command-output' || payload.type === 'stdout' || payload.type === 'stderr') {
      const text = payload.text || '';

      // Common error patterns
      const errorPatterns = [
        /npm ERR!.*/,
        /Cannot find module/,
        /SyntaxError/,
        /TypeError/,
        /ReferenceError/,
        /Module not found/,
        /Failed to compile/,
        /ENOENT.*/
      ];

      for (const pattern of errorPatterns) {
        if (pattern.test(text)) {
          errors.push({
            message: text.trim(),
            source: 'build-output'
          });
          break;
        }
      }
    }
  }

  return { errors, warnings };
};

// Generate actionable error summary
const generateErrorSummary = (errors) => {
  if (!errors || errors.length === 0) {
    return 'No errors found in logs.';
  }

  // Prioritize errors by type
  const prioritizedErrors = errors.filter(e => e.file).concat(errors.filter(e => !e.file));

  const summary = prioritizedErrors.slice(0, 3).map((err, idx) => {
    const location = err.file
      ? `${err.file}${err.line ? `:${err.line}` : ''}`
      : 'Build output';

    return `${idx + 1}. [${location}] ${err.message.substring(0, 100)}`;
  }).join('\n');

  return summary;
};

// Create AI service instance
const createAIService = (apiKey) => new AIService(apiKey);

module.exports = {
  AIService,
  createAIService,
  parseBuildError,
  generateErrorSummary
};