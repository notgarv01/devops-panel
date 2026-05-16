const axios = require('axios');

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
      // Filter to only error-related lines to reduce payload size
      const logLines = (buildLogs || []).map(log => log.message || '').filter(Boolean);
      const errorLines = logLines.filter(line =>
        /error|failed|exception|invalid|missing|warn|err/i.test(line)
      );

      // Use only last 20 relevant lines, or last 10 if no errors found
      const trimmedLines = errorLines.length > 0
        ? errorLines.slice(-20)
        : logLines.slice(-10);

      const logText = trimmedLines.map(line => line.substring(0, 200)).join('\n');

      // Add delay to prevent burst rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

      const systemPrompt = `You are a DevOps engineer specializing in debugging build failures.
When given Vercel build logs, identify the root cause and provide a clear, actionable fix.
Keep responses concise (2-3 sentences max).`;

      const userPrompt = `Vercel build failed. Diagnose the issue:\n${logText}`;

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
          max_tokens: 500,
          temperature: 0.3
        });
        response = response.choices[0]?.message?.content;
      }

      const diagnosis = this.useGemini ? response : response;

      return {
        success: true,
        diagnosis: diagnosis,
        issue: this.extractIssue(diagnosis),
        suggestion: this.extractSuggestion(diagnosis),
        confidence: 'high'
      };

    } catch (error) {
      console.error('[AI Service] Diagnosis failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async geminiDiagnose(userPrompt, systemPrompt) {
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const url = `${this.geminiBaseUrl}/models/${this.model}:generateContent?key=${this.geminiKey}`;

    const response = await axios.post(url, {
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.3
      }
    }, { timeout: 30000 });

    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No diagnosis available';
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