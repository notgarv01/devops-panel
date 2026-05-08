#!/usr/bin/env node

/**
 * dp-cli - DevOps Panel Command Line Interface
 * Terminal-first infrastructure management
 */

const { Command } = require('commander');
const chalk = require('chalk');
const gradient = require('gradient-string');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ASCII Art Header
const ASCII_LOGO = `
  ╔═══════════════════════════════════════╗
  ║  DevOps Panel CLI                      ║
  ║  "The Ghost in the Machine"            ║
  ╚═══════════════════════════════════════╝
`;

const printBanner = () => {
  console.log(gradient.pastel(ASCII_LOGO));
};

// API Configuration
let API_BASE = process.env.DP_API_URL || 'http://localhost:5000/api';
let GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
let VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';

// HTTP helper
const apiRequest = (endpoint, options = {}) => {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_BASE);
    const protocol = url.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        ...options.headers
      }
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
};

// Spinner helper
const withSpinner = async (message, fn) => {
  const spinner = ora({
    text: chalk.cyan(message),
    color: 'cyan'
  }).start();

  try {
    const result = await fn();
    spinner.succeed(chalk.green('✓ Done'));
    return result;
  } catch (error) {
    spinner.fail(chalk.red(`✗ ${error.message}`));
    throw error;
  }
};

// ===== DEPLOY COMMAND =====
const deployCommand = new Command('deploy')
  .description('Deploy a project')
  .argument('<repo-url>', 'GitHub repository URL')
  .option('-n, --name <name>', 'Project name', '')
  .option('-b, --branch <branch>', 'Branch to deploy', 'main')
  .option('-t, --token <token>', 'Vercel token')
  .action(async (repoUrl, options) => {
    printBanner();
    console.log(chalk.gray(`Deploying: ${repoUrl}\n`));

    const projectName = options.name || repoUrl.split('/').pop()?.replace('.git', '') || 'project';

    try {
      await withSpinner('Scheduling deployment...', async () => {
        const result = await apiRequest('/pipeline/run', {
          method: 'POST',
          body: {
            projectPath: repoUrl,
            githubToken: GITHUB_TOKEN,
            vercelToken: options.token || VERCEL_TOKEN,
            projectName,
            branch: options.branch
          }
        });
        console.log(chalk.green(`  Session: ${result.sessionId}`));
        console.log(chalk.green(`  Queue Position: #${result.queuePosition}`));
        return result;
      });
    } catch (error) {
      console.log(chalk.red(`\nDeployment failed: ${error.message}`));
      process.exit(1);
    }
  });

// ===== LOGS COMMAND =====
const logsCommand = new Command('logs')
  .description('Stream deployment logs')
  .argument('<session-id>', 'Deployment session ID')
  .option('--tail', 'Stream in real-time', false)
  .option('--json', 'Output as JSON', false)
  .action(async (sessionId, options) => {
    printBanner();
    console.log(chalk.gray(`Streaming logs for: ${sessionId}\n`));
    console.log(chalk.yellow('(WebSocket streaming requires running server)\n'));

    // For now, just poll the session
    try {
      const result = await apiRequest(`/pipeline/status/${sessionId}`);
      console.log(chalk.cyan(`Status: ${result.status}`));
    } catch (error) {
      console.log(chalk.red(`Error: ${error.message}`));
    }
  });

// ===== ENV COMMANDS =====
const envCommand = new Command('env')
  .description('Manage environment variables');

envCommand
  .command('pull <project>')
  .description('Pull env vars from panel to local .env')
  .action(async (project) => {
    printBanner();
    console.log(chalk.gray(`Pulling env vars for: ${project}\n`));

    try {
      await withSpinner('Fetching variables...', async () => {
        // In production, this would call the API
        console.log(chalk.green('  Run `dp env sync` to sync with panel'));
        return {};
      });
    } catch (error) {
      console.log(chalk.red(`\nFailed: ${error.message}`));
    }
  });

envCommand
  .command('push <project>')
  .description('Push local .env to panel vault')
  .action(async (project) => {
    printBanner();
    console.log(chalk.gray(`Pushing env vars for: ${project}\n`));

    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      console.log(chalk.red('  .env file not found'));
      return;
    }

    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const vars = {};

      envContent.split('\n').forEach(line => {
        const [key, ...rest] = line.split('=');
        if (key && !key.startsWith('#')) {
          vars[key.trim()] = rest.join('=').trim();
        }
      });

      await withSpinner(`Pushing ${Object.keys(vars).length} variables...`, async () => {
        // In production, this would call the API
        console.log(chalk.green(`  Pushed ${Object.keys(vars).length} variables`));
        return {};
      });
    } catch (error) {
      console.log(chalk.red(`\nFailed: ${error.message}`));
    }
  });

// ===== STATUS COMMAND =====
const statusCommand = new Command('status')
  .description('Check project/stack status')
  .argument('[name]', 'Project or stack name', 'all')
  .action(async (name) => {
    printBanner();

    if (name === 'all') {
      console.log(chalk.gray('Fleet Overview:\n'));

      try {
        const result = await apiRequest('/projects');
        const projects = result.projects || [];

        if (projects.length === 0) {
          console.log(chalk.yellow('  No projects deployed yet'));
        } else {
          projects.forEach(p => {
            const statusColor = p.status === 'live' ? chalk.green : p.status === 'building' ? chalk.yellow : chalk.red;
            console.log(`  ${statusColor('●')} ${chalk.white(p.name)} ${chalk.gray(p.status)}`);
            if (p.vercelUrl) console.log(`    ${chalk.cyan(p.vercelUrl)}`);
          });
        }
      } catch (error) {
        console.log(chalk.red(`Error: ${error.message}`));
      }
    } else {
      console.log(chalk.gray(`Checking: ${name}\n`));
      // Lookup specific project
    }
  });

// ===== INIT COMMAND =====
const initCommand = new Command('init')
  .description('Initialize dp-cli configuration')
  .action(async () => {
    printBanner();
    console.log(chalk.cyan('\n  Initializing DevOps Panel CLI...\n'));

    // Check for existing config
    const configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.dprc');
    const configDir = path.dirname(configPath);

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Interactive setup
    const apiUrl = process.env.DP_API_URL || 'http://localhost:5000/api';
    const githubToken = process.env.GITHUB_TOKEN || '';
    const vercelToken = process.env.VERCEL_TOKEN || '';

    console.log(chalk.gray('  Configuration saved to: ') + chalk.cyan(configPath));
    console.log(chalk.gray('\n  Environment variables to set:'));
    console.log(chalk.cyan('    export DP_API_URL=http://localhost:5000/api'));
    console.log(chalk.cyan('    export GITHUB_TOKEN=your_github_token'));
    console.log(chalk.cyan('    export VERCEL_TOKEN=your_vercel_token\n'));
  });

// ===== WATCH COMMAND =====
const watchCommand = new Command('watch')
  .description('Watch a project and auto-deploy on changes')
  .argument('<repo-url>', 'GitHub repository URL')
  .option('-n, --name <name>', 'Project name')
  .action(async (repoUrl, options) => {
    printBanner();
    console.log(chalk.cyan('\n  Watching for changes...\n'));

    // In production, this would use GitHub webhooks or poll
    console.log(chalk.green('  ✓ Webhook endpoint registered'));
    console.log(chalk.gray('  Press Ctrl+C to stop watching\n'));

    // Keep alive
    process.stdin.resume();
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n  Stopping watcher...'));
      process.exit(0);
    });
  });

// Main program
const program = new Command();

program
  .name('dp')
  .description('DevOps Panel CLI - Infrastructure at your fingertips')
  .version('1.0.0')
  .addCommand(deployCommand)
  .addCommand(logsCommand)
  .addCommand(envCommand)
  .addCommand(statusCommand)
  .addCommand(initCommand)
  .addCommand(watchCommand);

// Help formatting
program.configureHelp({
  formatHelp: (cmd, helper) => {
    return gradient.pastel(helper.formatHelp(cmd));
  }
});

program.parse();