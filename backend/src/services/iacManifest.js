const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

/**
 * devops.yaml Schema
 *
 * This file allows users to define infrastructure-as-code for their deployments.
 * It overrides any UI settings when present in the repository.
 */

const DEVOPS_YAML_FILES = [
  'devops.yaml',
  'devops.yml',
  '.devops.yaml',
  '.devops.yml'
];

// Default configuration
const DEFAULT_CONFIG = {
  stack: null,
  transmute: {
    localhostPatterns: [
      { pattern: /https?:\/\/localhost:\d+/gi, replace: 'process.env.VITE_API_URL' },
      { pattern: /fetch\s*\(\s*['"]http:\/\/localhost:\d+/gi, replace: 'fetch(process.env.VITE_API_URL + "' }
    ],
    prefix: 'VITE_'
  },
  notifications: {
    channels: [],
    events: ['success', 'failure']
  },
  janitor: {
    enabled: true,
    pruneAfter: '7d', // days
    pruneStatuses: ['ready', 'failed', 'error']
  },
  deployment: {
    targets: ['vercel'],
    framework: null, // auto-detect
    environment: 'production'
  },
  security: {
    scanSecrets: true,
    blockOnCritical: true
  },
  webhook: {
    autoSync: true,
    deployOnPush: true
  }
};

class IaCManifest {
  constructor() {
    this.config = null;
    this.sourceDir = null;
  }

  /**
   * Try to load devops.yaml from a directory
   */
  async load(workDir) {
    this.sourceDir = workDir;
    this.config = null;

    for (const fileName of DEVOPS_YAML_FILES) {
      const filePath = path.join(workDir, fileName);

      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = yaml.parse(content);
          this.config = this.mergeWithDefaults(parsed);
          console.log(`[IaC] Loaded ${fileName} from ${workDir}`);
          return this.config;
        } catch (error) {
          console.log(`[IaC] Failed to parse ${fileName}: ${error.message}`);
        }
      }
    }

    // No config found, return defaults
    this.config = { ...DEFAULT_CONFIG };
    return this.config;
  }

  /**
   * Merge parsed YAML with defaults
   */
  mergeWithDefaults(config) {
    return {
      stack: config.stack || DEFAULT_CONFIG.stack,
      transmute: {
        localhostPatterns: config.transpose?.localhostPatterns ||
                           config.transmute?.localhostPatterns ||
                           DEFAULT_CONFIG.transmute.localhostPatterns,
        prefix: config.transmute?.prefix || config.transpose?.prefix || DEFAULT_CONFIG.transmute.prefix,
        additionalPatterns: config.transmute?.additionalPatterns || []
      },
      notifications: {
        channels: config.notifications?.channels || DEFAULT_CONFIG.notifications.channels,
        events: config.notifications?.events || DEFAULT_CONFIG.notifications.events
      },
      janitor: {
        enabled: config.janitor?.enabled !== undefined ? config.janitor.enabled : DEFAULT_CONFIG.janitor.enabled,
        pruneAfter: config.janitor?.pruneAfter || DEFAULT_CONFIG.janitor.pruneAfter,
        pruneStatuses: config.janitor?.pruneStatuses || DEFAULT_CONFIG.janitor.pruneStatuses
      },
      deployment: {
        targets: config.deployment?.targets || DEFAULT_CONFIG.deployment.targets,
        framework: config.deployment?.framework || DEFAULT_CONFIG.deployment.framework,
        environment: config.deployment?.environment || DEFAULT_CONFIG.deployment.environment
      },
      security: {
        scanSecrets: config.security?.scanSecrets !== undefined ? config.security.scanSecrets : DEFAULT_CONFIG.security.scanSecrets,
        blockOnCritical: config.security?.blockOnCritical !== undefined ? config.security.blockOnCritical : DEFAULT_CONFIG.security.blockOnCritical
      },
      webhook: {
        autoSync: config.webhook?.autoSync !== undefined ? config.webhook.autoSync : DEFAULT_CONFIG.webhook.autoSync,
        deployOnPush: config.webhook?.deployOnPush !== undefined ? config.webhook.deployOnPush : DEFAULT_CONFIG.webhook.deployOnPush
      }
    };
  }

  /**
   * Get the transmute patterns
   */
  getTransmutePatterns() {
    if (!this.config) return [];

    const patterns = [];

    // Add custom patterns from config
    if (this.config.transmute.localhostPatterns) {
      this.config.transmute.localhostPatterns.forEach(p => {
        if (typeof p === 'string') {
          // Parse string pattern (format: "find -> replace")
          const [find, replace] = p.split('->').map(s => s.trim());
          patterns.push({ pattern: new RegExp(find, 'gi'), replace });
        } else if (p.pattern && p.replace) {
          patterns.push(p);
        }
      });
    }

    // Add additional patterns
    if (this.config.transmute.additionalPatterns) {
      this.config.transmute.additionalPatterns.forEach(p => {
        patterns.push(p);
      });
    }

    return patterns;
  }

  /**
   * Get prefix for environment variables
   */
  getEnvPrefix() {
    return this.config?.transmute?.prefix || 'VITE_';
  }

  /**
   * Get notification channels
   */
  getNotificationChannels() {
    return this.config?.notifications?.channels || [];
  }

  /**
   * Get janitor settings
   */
  getJanitorSettings() {
    if (!this.config?.janitor?.enabled) {
      return { enabled: false };
    }

    return {
      enabled: true,
      pruneAfter: this.parseTimeToDays(this.config.janitor.pruneAfter),
      pruneStatuses: this.config.janitor.pruneStatuses
    };
  }

  /**
   * Get deployment targets
   */
  getDeploymentTargets() {
    return this.config?.deployment?.targets || ['vercel'];
  }

  /**
   * Check if security scanning is enabled
   */
  isSecurityScanningEnabled() {
    return this.config?.security?.scanSecrets !== false;
  }

  /**
   * Check if secrets should block deployment
   */
  shouldBlockOnSecrets() {
    return this.config?.security?.blockOnCritical !== false;
  }

  /**
   * Parse time string to days
   */
  parseTimeToDays(timeStr) {
    if (!timeStr) return 7;

    const match = timeStr.match(/(\d+)([dwh])/);
    if (!match) return 7;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'd': return value;
      case 'w': return value * 7;
      case 'h': return value / 24;
      default: return 7;
    }
  }

  /**
   * Check if auto-sync is enabled
   */
  isAutoSyncEnabled() {
    return this.config?.webhook?.autoSync !== false;
  }

  /**
   * Get raw config for debugging
   */
  getRawConfig() {
    return this.config;
  }
}

// Create singleton
const createIaCManifest = () => new IaCManifest();

// Example devops.yaml template
const TEMPLATE_YAML = `# DevOps Panel - Infrastructure as Code
# Place this file in your repository root to configure deployments

# Stack grouping (optional)
stack: "my-app-stack"

# Transmutation settings (source code fixes)
transmute:
  # Environment variable prefix
  prefix: "VITE_"

  # Custom localhost replacement patterns
  localhostPatterns:
    - pattern: "localhost:3000"
      replace: "process.env.VITE_API_URL"
    - pattern: "localhost:5173"
      replace: "process.env.VITE_API_URL"

  # Additional transmutation patterns
  additionalPatterns:
    - pattern: "api.example.com"
      replace: "process.env.VITE_API_URL"

# Notification channels
notifications:
  channels:
    - type: "slack"
      webhook: "https://hooks.slack.com/..."
    - type: "discord"
      webhook: "https://discord.com/api/webhooks/..."
  events:
    - "success"
    - "failure"

# Janitor settings (auto-cleanup)
janitor:
  enabled: true
  pruneAfter: "7d"  # Delete branches after 7 days
  pruneStatuses:
    - "ready"
    - "failed"

# Deployment targets
deployment:
  targets:
    - "vercel"
    # - "netlify"  # Add more targets as needed
  environment: "production"

# Security settings
security:
  scanSecrets: true
  blockOnCritical: true

# Webhook settings
webhook:
  autoSync: true
  deployOnPush: true  # Auto-deploy on main branch push
`;

module.exports = {
  IaCManifest,
  createIaCManifest,
  TEMPLATE_YAML,
  DEVOPS_YAML_FILES
};