const fs = require('fs');
const path = require('path');

// Secret patterns to scan for
const SECRET_PATTERNS = [
  // AWS Keys
  {
    pattern: /AKIA[0-9A-Z]{16}/,
    type: 'AWS Access Key',
    severity: 'critical',
    message: 'AWS Access Key ID detected'
  },
  {
    pattern: /(?<![A-Z0-9])[A-Za-z0-9\/+=]{40}(?![A-Z0-9])/,
    type: 'AWS Secret Key',
    severity: 'critical',
    message: 'Potential AWS Secret Key detected'
  },
  // Stripe
  {
    pattern: /sk_live_[0-9a-zA-Z]{24,}/,
    type: 'Stripe Secret Key',
    severity: 'critical',
    message: 'Stripe Live Secret Key detected'
  },
  {
    pattern: /rk_live_[0-9a-zA-Z]{24,}/,
    type: 'Stripe Restricted Key',
    severity: 'critical',
    message: 'Stripe Restricted Key detected'
  },
  // Firebase
  {
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    type: 'Firebase API Key',
    severity: 'critical',
    message: 'Firebase API Key detected'
  },
  // GitHub Tokens
  {
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    type: 'GitHub Token',
    severity: 'critical',
    message: 'GitHub Personal Access Token detected'
  },
  // Private Keys
  {
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    type: 'Private Key',
    severity: 'critical',
    message: 'Private Key detected'
  },
  // Database URLs
  {
    pattern: /(mongodb|postgres|mysql):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/,
    type: 'Database Connection String',
    severity: 'high',
    message: 'Database connection string with credentials detected'
  },
  // Slack Tokens
  {
    pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,}/,
    type: 'Slack Token',
    severity: 'high',
    message: 'Slack Token detected'
  },
  // SendGrid
  {
    pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/,
    type: 'SendGrid API Key',
    severity: 'high',
    message: 'SendGrid API Key detected'
  },
  // Google API
  {
    pattern: /AIza[a-zA-Z0-9_-]{35}/,
    type: 'Google API Key',
    severity: 'high',
    message: 'Google API Key detected'
  },
  // Generic API Keys
  {
    pattern: /(api[_-]?key|apikey|api_secret)[=:]\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
    type: 'API Key',
    severity: 'medium',
    message: 'Generic API Key pattern detected'
  },
  // JWT Tokens
  {
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    type: 'JWT Token',
    severity: 'high',
    message: 'JWT Token detected'
  },
  // Vercel Token
  {
    pattern: /[a-zA-Z0-9]{24,}_[a-zA-Z0-9]{24,}/,
    type: 'Vercel Token',
    severity: 'high',
    message: 'Potential Vercel token detected'
  }
];

// Files to skip during scanning (lock files are safe to skip - they contain checksums, not real secrets)
const SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  'vendor',
  'bower_components'
];

const SKIP_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'secrets.json',
  'credentials.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'Podfile.lock',
  'package.json'  // Only scan for secrets in package.json if explicitly needed
];

class SecretSentinel {
  constructor(options = {}) {
    this.options = {
      severityThreshold: 'medium',
      failOnCritical: true,
      ...options
    };
    this.findings = [];
    this.scannedFiles = 0;
    this.skippedFiles = 0;
  }

  // Main scan method
  async scanDirectory(dirPath) {
    this.findings = [];
    this.scannedFiles = 0;
    this.skippedFiles = 0;

    await this.walkDirectory(dirPath);

    return this.generateReport();
  }

  // Recursive directory walk
  async walkDirectory(dirPath, depth = 0) {
    if (depth > 10) return; // Prevent infinite recursion

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip hidden directories
        if (entry.name.startsWith('.')) continue;

        // Skip blacklisted directories
        if (SKIP_DIRS.includes(entry.name)) {
          this.skippedFiles++;
          continue;
        }

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, depth + 1);
        } else if (entry.isFile()) {
          await this.scanFile(fullPath);
        }
      }
    } catch (error) {
      console.log(`[SecretSentinel] Cannot access ${dirPath}: ${error.message}`);
    }
  }

  // Scan individual file
  async scanFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // Only scan text-based files
    const textExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.env', '.yaml', '.yml', '.txt', '.md', '.py', '.rb', '.go', '.java', '.php', '.cs', '.cpp', '.c', '.h'];
    if (!textExtensions.includes(ext)) {
      this.skippedFiles++;
      return;
    }

    const fileName = path.basename(filePath);
    const fullPathLower = filePath.toLowerCase();

    // Skip known secret files and lock files
    if (SKIP_FILES.some(skip => fullPathLower.includes(skip.toLowerCase()))) {
      this.skippedFiles++;
      return;
    }

    this.scannedFiles++;

    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const relativePath = filePath;

      for (const secret of SECRET_PATTERNS) {
        const matches = content.matchAll(new RegExp(secret.pattern, 'gi'));

        for (const match of matches) {
          // Get line number
          const lines = content.substring(0, match.index).split('\n');
          const lineNumber = lines.length;

          // Extract context (surrounding code)
          const lineStart = Math.max(0, match.index - 50);
          const lineEnd = Math.min(content.length, match.index + match[0].length + 50);
          const context = content.substring(lineStart, lineEnd).replace(/\n/g, ' ').trim();

          this.findings.push({
            type: secret.type,
            severity: secret.severity,
            message: secret.message,
            file: relativePath,
            line: lineNumber,
            context: this.maskSecret(match[0]),
            matched: match[0].substring(0, 10) + '...'
          });
        }
      }
    } catch (error) {
      // Binary or unreadable file
    }
  }

  // Mask the secret in output
  maskSecret(secret) {
    if (secret.length <= 8) return '********';
    return secret.substring(0, 4) + '*'.repeat(secret.length - 8) + secret.substring(secret.length - 4);
  }

  // Generate the scan report
  generateReport() {
    const criticalCount = this.findings.filter(f => f.severity === 'critical').length;
    const highCount = this.findings.filter(f => f.severity === 'high').length;
    const mediumCount = this.findings.filter(f => f.severity === 'medium').length;

    const hasCritical = criticalCount > 0;

    return {
      safe: !hasCritical || !this.options.failOnCritical,
      hasCritical,
      summary: {
        scanned: this.scannedFiles,
        skipped: this.skippedFiles,
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        total: this.findings.length
      },
      findings: this.findings.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      blocked: hasCritical && this.options.failOnCritical
    };
  }

  // Quick check for common secret files
  static checkFileForSecrets(filePath) {
    const fileName = path.basename(filePath);
    const dangerousPatterns = [
      /config\.js/,
      /credentials/,
      /secrets/,
      /\.env\./
    ];

    return dangerousPatterns.some(pattern => pattern.test(fileName));
  }
}

// Create sentinel instance
const createSentinel = (options) => new SecretSentinel(options);

module.exports = { SecretSentinel, createSentinel };