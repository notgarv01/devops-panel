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
      const logText = this.formatLogs(buildLogs);

      const systemPrompt = `You are a DevOps engineer specializing in debugging build failures.
When given Vercel build logs, identify the root cause and provide a clear, actionable fix.
Keep responses concise (2-3 sentences max).`;

      const userPrompt = `Analyze these Vercel build logs and identify the issue:

${logText}

If there's an error, explain what went wrong and what the user should do to fix it.
If there's no clear error, say "No obvious issue found in the logs."`;

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

    // Take last 50 lines of logs (most relevant for failures) to avoid token limits
    const recentLogs = logs.slice(-50);
    return recentLogs.map(log => {
      const timestamp = log.timestamp ? new Date(log.timestamp).toISOString() : '';
      const level = log.level || 'info';
      const message = (log.message || '').substring(0, 500); // Truncate long lines
      return `[${level}] ${message}`;
    }).join('\n');
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