const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const simpleGit = require('simple-git');
const { analyzeProject, PROJECT_TYPES } = require('../utils/analyzer');
const { transformForDeployment } = require('../utils/transformer');
const { createGitHubService } = require('./github.service');
const { createVercelService } = require('./vercel.service');
const Project = require('../models/Project');
const { createAIService, parseBuildError } = require('./ai.service');
const { SecretSentinel } = require('./secretSentinel');

// Project persistence helper
const updateProjectStatus = async (projectName, updates) => {
  try {
    await Project.findOneAndUpdate(
      { name: projectName },
      { ...updates, updatedAt: new Date() },
      { new: true, upsert: false }
    );
  } catch (error) {
    console.log(`[Project] Failed to update status: ${error.message}`);
  }
};

// Emit project status change via socket
const emitProjectUpdate = (io, projectName, status, data = {}) => {
  if (io) {
    io.emit('project-update', {
      projectName,
      status,
      timestamp: new Date(),
      ...data
    });
  }
};

class LogStreamer {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.io = null;
    this.currentStep = 0;
  }

  setIO(io) {
    this.io = io;
  }

  emit(level, message, data = null) {
    const entry = {
      sessionId: this.sessionId,
      timestamp: new Date(),
      level,
      message,
      step: this.currentStep,
      ...(data && { data })
    };

    if (this.io) {
      this.io.to(this.sessionId).emit('pipeline-log', entry);
    }

    console.log(`[Pipeline:${this.sessionId}] [${level}] ${message}`);
    return entry;
  }

  step(number, total, label) {
    this.currentStep = number;
    const percentage = Math.round((number / total) * 100);
    this.emit('info', `Step ${number}/${total}: ${label}`);

    if (this.io) {
      this.io.to(this.sessionId).emit('pipeline-progress', {
        step: number,
        total,
        label,
        percentage,
        sessionId: this.sessionId
      });
    }

    return this;
  }

  success(message, data = null) {
    this.emit('success', message, data);
    return this;
  }

  error(message, data = null) {
    this.emit('error', message, data);
    return this;
  }

  warning(message, data = null) {
    this.emit('warning', message, data);
    return this;
  }
}

// Clone GitHub repo to temp directory
const cloneRepo = async (repoUrl, targetDir, preferredBranch = null) => {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const branchPriority = preferredBranch
    ? [preferredBranch, ...['main', 'master'].filter(b => b !== preferredBranch)]
    : ['main', 'master'];

  const git = simpleGit();

  for (const branch of branchPriority) {
    try {
      await git.clone(repoUrl, targetDir, ['--branch', branch, '--single-branch', '--depth', '1']);
      const actualGit = simpleGit(targetDir);
      const branchOutput = (await actualGit.branch()).current;
      return { success: true, path: targetDir, branch: branchOutput || branch };
    } catch (error) {
      continue;
    }
  }

  try {
    await git.clone(repoUrl, targetDir, ['--depth', '1']);
    const actualGit = simpleGit(targetDir);
    const branchOutput = (await actualGit.branch()).current;
    return { success: true, path: targetDir, branch: branchOutput || 'default' };
  } catch (error) {
    return { success: false, error: 'Could not clone repository. Please check the URL and your access permissions.' };
  }
};

const isGitHubUrl = (str) => {
  return str && (str.includes('github.com') || str.startsWith('https://'));
};

// ===== STEP 3: DEEP TRANSMUTATION (Source Code Fixer) =====
const transmuteSourceCode = async (workDir, logs, options = {}) => {
  const { projectType, envVars = [] } = options;
  const isViteProject = projectType === PROJECT_TYPES.FRONTEND_FRAMEWORK;

  const results = {
    filesModified: 0,
    fixes: []
  };

  const transmutationRules = [
    {
      pattern: /(https?:\/\/)localhost:(\d+)/gi,
      replace: (match, protocol, port) => {
        results.fixes.push({
          file: 'pattern-replace',
          find: match,
          replace: `${protocol}process.env.VITE_API_URL`
        });
        return `${protocol}process.env.VITE_API_URL`;
      }
    },
    {
      pattern: /fetch\s*\(\s*['"]http:\/\/localhost:\d+[^'"]*['"]\s*/gi,
      replace: (match) => {
        results.fixes.push({
          file: 'pattern-replace',
          find: match,
          replace: 'fetch(process.env.VITE_API_URL + '
        });
        return match.replace(/fetch\s*\(\s*['"]http:\/\/localhost:\d+/gi, 'fetch(process.env.VITE_API_URL + "');
      }
    },
    {
      pattern: /baseURL:\s*['"]http:\/\/localhost:\d+[^'"]*['"]/gi,
      replace: (match) => {
        results.fixes.push({
          file: 'pattern-replace',
          find: match,
          replace: "baseURL: process.env.VITE_API_URL"
        });
        return "baseURL: process.env.VITE_API_URL";
      }
    },
    {
      pattern: /(const|let|var)\s+API_URL\s*=\s*['"]https?:\/\/localhost:\d+[^'"]*['"]/gi,
      replace: (match) => {
        results.fixes.push({
          file: 'pattern-replace',
          find: match,
          replace: "$1API_URL = process.env.VITE_API_URL || ''"
        });
        return "$1API_URL = process.env.VITE_API_URL || ''";
      }
    }
  ];

  const sourceDirs = ['src', 'client', 'frontend', 'app', 'components', 'pages', 'lib', 'utils', 'api', 'services'];
  const sourceExtensions = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'];

  const scanDir = async (dir, depth = 0) => {
    if (depth > 5) return;

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.next') {
          continue;
        }

        if (entry.isDirectory()) {
          await scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!sourceExtensions.includes(ext)) continue;

          await processFile(fullPath);
        }
      }
    } catch (err) {}
  };

  const processFile = async (filePath) => {
    try {
      let content = await fs.promises.readFile(filePath, 'utf8');
      let modified = false;
      const originalContent = content;

      for (const rule of transmutationRules) {
        if (rule.replace) {
          const newContent = content.replace(rule.pattern, rule.replace);
          if (newContent !== content) {
            content = newContent;
            modified = true;
          }
        }
      }

      // Add VITE_ prefix to process.env.X calls if missing (for Vite projects)
      if (isViteProject) {
        const nonViteEnvs = ['NODE_ENV', 'PORT', 'HOST', 'HOME', 'PATH', 'USER', 'SHELL'];
        const pattern = /process\.env\.([A-Z_][A-Z0-9_]*)/gi;
        content = content.replace(pattern, (match, varName) => {
          if (nonViteEnvs.includes(varName)) return match;
          if (!varName.startsWith('VITE_')) {
            results.fixes.push({
              file: path.relative(workDir, filePath),
              find: match,
              replace: `process.env.VITE_${varName}`
            });
            return `process.env.VITE_${varName}`;
          }
          return match;
        });
        if (content !== originalContent) modified = true;
      }

      if (modified) {
        await fs.promises.writeFile(filePath, content, 'utf8');
        results.filesModified++;
      }
    } catch (err) {}
  };

  await scanDir(workDir);

  return results;
};

const runTransformationPipeline = async (io, sessionId, config) => {
  const logs = new LogStreamer(sessionId);
  logs.setIO(io);

  const {
    projectPath,
    githubToken,
    vercelToken = null,
    projectName,
    branch = 'main',
    envVars = [],
    options = {}
  } = config;

  const totalSteps = vercelToken ? 8 : 7;
  let workDir = null;
  let repoInfo = null;

  // Generate target branch name
  const targetBranch = `devops-deploy-${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 8)}`;

  try {
    logs.emit('info', `Starting pipeline for: ${projectName}`);
    logs.emit('info', `Target branch: ${targetBranch}`);

    // ===== STEP 1: CLONE OR ACCESS =====
    logs.step(1, totalSteps, 'Fetching project code');

    let actualBranch = branch || 'main';

    if (isGitHubUrl(projectPath)) {
      workDir = path.join(os.tmpdir(), `pipeline-${sessionId}`);
      logs.emit('info', `Cloning from GitHub...`);

      const cloneResult = await cloneRepo(projectPath, workDir, branch);
      if (!cloneResult.success) {
        throw new Error(`Clone failed: ${cloneResult.error}`);
      }
      actualBranch = cloneResult.branch;

      // Parse owner/repo from URL
      const urlMatch = projectPath.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
      if (urlMatch) {
        repoInfo = {
          owner: urlMatch[1],
          repo: urlMatch[2].replace('.git', ''),
          url: projectPath
        };
        logs.emit('info', `Repository: ${repoInfo.owner}/${repoInfo.repo}`);
      }

      logs.success(`Repository cloned (${actualBranch} branch) to ${workDir}`);

      // Update project status: Fetch complete, now building
      await updateProjectStatus(projectName, {
        status: 'building',
        mainBranch: actualBranch,
        githubUrl: projectPath,
        framework: 'detecting'
      });
      emitProjectUpdate(io, projectName, 'building', { step: 1 });
    } else {
      workDir = projectPath;
      if (!fs.existsSync(workDir)) {
        throw new Error(`Directory not found: ${workDir}`);
      }
      const localGit = simpleGit(workDir);
      actualBranch = (await localGit.branch()).current || 'main';
      logs.success(`Using local directory`);
    }

    // ===== STEP 2: ANALYSIS =====
    logs.step(2, totalSteps, 'Analyzing project structure');
    logs.emit('info', `Scanning files...`);

    const analysis = await analyzeProject(workDir);

    logs.success(`Detected: ${analysis.projectType.type}`, {
      type: analysis.projectType.type,
      confidence: Math.round(analysis.projectType.confidence * 100) + '%',
      signals: analysis.projectType.signals
    });

    // Update project with detected framework
    await updateProjectStatus(projectName, {
      framework: analysis.projectType.type.toLowerCase()
    });
    emitProjectUpdate(io, projectName, 'building', { step: 2, framework: analysis.projectType.type });

    // ===== STEP 2.5: SECRET SENTINEL (Security Pre-Check) =====
    logs.step(2.5, totalSteps + 0.5, 'Scanning for secrets');
    logs.emit('info', `Checking for leaked API keys...`);

    const sentinel = new SecretSentinel({ failOnCritical: true });
    const securityReport = await sentinel.scanDirectory(workDir);

    if (securityReport.hasCritical) {
      logs.emit('error', `CRITICAL: ${securityReport.summary.critical} leaked secret(s) detected!`);
      logs.emit('error', 'Fix these files before deploying:');
      securityReport.findings
        .filter(f => f.severity === 'critical')
        .slice(0, 5)
        .forEach(finding => {
          logs.emit('error', `  ${finding.file}:${finding.line} - ${finding.type}`);
        });

      // Emit security alert to UI
      io.to(sessionId).emit('security-alert', {
        type: 'secrets-detected',
        findings: securityReport.findings.filter(f => f.severity === 'critical'),
        blocked: true
      });

      throw new Error('SECRET_SENTINEL_BLOCKED: Critical secrets found in codebase. Move them to environment variables and retry.');
    }

    if (securityReport.findings.length > 0) {
      logs.emit('warning', `Found ${securityReport.summary.total} potential secrets (non-blocking)`);
      securityReport.findings.slice(0, 3).forEach(f => {
        logs.emit('info', `  ${f.file}:${f.line} - ${f.type}`);
      });
    } else {
      logs.success('No secrets detected - code is clean');
    }

    // ===== STEP 3: TRANSMUTATION (Source Code Fixes) =====
    logs.step(3, totalSteps, 'Transmuting source code');
    logs.emit('info', `Scanning for localhost patterns...`);

    const transmutationResults = await transmuteSourceCode(workDir, logs, {
      projectType: analysis.projectType.type,
      envVars
    });

    logs.success(`Transmuted ${transmutationResults.filesModified} files`);
    if (transmutationResults.fixes.length > 0) {
      transmutationResults.fixes.slice(0, 5).forEach(fix => {
        logs.emit('info', `  -> ${fix.file}: ${fix.find} -> ${fix.replace}`);
      });
      if (transmutationResults.fixes.length > 5) {
        logs.emit('info', `  ... and ${transmutationResults.fixes.length - 5} more fixes`);
      }
    }

    // Update project status after transmutation
    await updateProjectStatus(projectName, {
      status: 'building'
    });
    emitProjectUpdate(io, projectName, 'building', { step: 3 });

    // ===== STEP 4: TRANSFORMATION =====
    logs.step(4, totalSteps, 'Generating deployment files');
    logs.emit('info', `Creating vercel.json...`);

    const transformResult = await transformForDeployment(workDir, analysis.projectType.type, {
      includeNowJson: options.includeNowJson || false
    });

    logs.success(`Created ${transformResult.files.length} deployment files`);

    // Log directory structure for debugging
    const listDir = async (dir, prefix = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries.slice(0, 20)) {
          logs.emit('info', `  ${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`);
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            await listDir(path.join(dir, entry.name), prefix + '  ');
          }
        }
      } catch {}
    };
    logs.emit('info', `Directory structure:`);
    await listDir(workDir);

    const vercelJsonPath = path.join(workDir, 'vercel.json');

    // ===== STEP 4: GITHUB SYNC (Same Repo, New Branch) =====
    logs.step(4, totalSteps, 'Syncing to GitHub');
    logs.emit('info', `Authenticating with GitHub...`);

    const github = createGitHubService(githubToken);
    const user = await github.getAuthenticatedUser();
    const owner = user.login;

    logs.emit('info', `Authenticated as: ${user.name || owner}`);

    // Use original repo name (from the cloned repo URL)
    const originalRepoName = repoInfo ? repoInfo.repo : projectName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const repoUrl = repoInfo ? repoInfo.url : projectPath;

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Push code to NEW BRANCH in SAME REPO
    logs.emit('info', `Pushing to ${targetBranch} branch in original repo...`);
    const remoteUrl = repoUrl.replace('.git', '').replace('https://', `https://x-access-token:${githubToken}@`);

    try {
      const git = simpleGit(workDir);

      logs.emit('info', `Git init...`);
      await git.init();

      logs.emit('info', `Git config...`);
      await git.addConfig('user.email', 'panel@devops.local', false, 'local');
      await git.addConfig('user.name', 'DevOps Panel', false, 'local');
      await git.addConfig('http.postBuffer', '524288000', false, 'local');
      await git.addConfig('core.compression', '0', false, 'local');

      // Ensure node_modules is in .gitignore
      const gitignorePath = path.join(workDir, '.gitignore');
      const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
      if (!gitignoreContent.includes('node_modules')) {
        fs.writeFileSync(gitignorePath, gitignoreContent + '\nnode_modules/\n');
      }

      fs.sync && fs.sync();

      logs.emit('info', `Git add...`);
      await git.add('.');

      if (fs.existsSync(vercelJsonPath)) {
        await git.add('vercel.json');
        logs.emit('info', `Staged vercel.json`);
      }

      logs.emit('info', `Git commit...`);
      await git.commit('Deploy via DevOps Panel - Transmuted for Vercel');

      logs.emit('info', `Creating ${targetBranch} branch...`);

      await git.branch(['-m', 'HEAD', targetBranch]).catch(() => {
        return git.checkoutLocalBranch(targetBranch);
      });

      logs.emit('info', `Git push to ${targetBranch}...`);

      try {
        const remotes = await git.getRemotes();
        if (remotes.some(r => r.name === 'origin')) {
          await git.removeRemote('origin');
        }
      } catch {}
      await git.addRemote('origin', remoteUrl);

      let pushSuccess = false;
      let pushError = null;

      for (let attempt = 1; attempt <= 3 && !pushSuccess; attempt++) {
        try {
          if (attempt === 1) await delay(500);
          await git.push(['-u', 'origin', targetBranch, '--force']);
          pushSuccess = true;
        } catch (pushErr) {
          pushError = pushErr;
          if (attempt < 3) {
            console.log(`[Pipeline:${sessionId}] Push attempt ${attempt} failed: ${pushErr.message.substring(0, 100)}`);
            await delay(attempt * 3000);
          }
        }
      }

      if (!pushSuccess) {
        throw new Error(`Git push failed: ${pushError?.message}`);
      }

      logs.success(`Code pushed to ${targetBranch} branch`);
      logs.emit('info', `Original repo: ${repoUrl}`);

      // Update project with branch info
      await updateProjectStatus(projectName, {
        targetBranch: targetBranch
      });
      emitProjectUpdate(io, projectName, 'building', { step: 5 });

      // Webhook installation updates
    } catch (gitError) {
      console.error(`[Pipeline:${sessionId}] Git error:`, gitError.message);
      throw new Error(`Git push failed: ${gitError.message}`);
    }

    // ===== STEP 6: WEBHOOK INJECTION =====
    if (repoInfo) {
      logs.step(6, totalSteps, 'Installing webhook');
      logs.emit('info', `Setting up auto-sync webhook...`);

      try {
        const webhookUrl = options.webhookUrl || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/webhooks/github`;

        const existingHooks = await github.listWebhooks(repoInfo.owner, repoInfo.repo);
        const existingHook = existingHooks.find(h => h.config?.url === webhookUrl);

        if (existingHook) {
          logs.emit('info', `Webhooks already configured`);
        } else {
          const webhook = await github.createWebhook(repoInfo.owner, repoInfo.repo, webhookUrl, ['push']);
          logs.success(`Webhook installed: ${webhook.id}`);
          logs.emit('info', `Webhook secret saved for verification`);
        }

        repoInfo.webhookConfigured = true;
      } catch (webhookError) {
        logs.emit('warning', `Webhook setup failed: ${webhookError.message}`);
        logs.emit('warning', `Manual webhook may be required for auto-sync`);
      }
    }

    console.log(`[Pipeline:${sessionId}] Git sync complete, checking Vercel step`);

    // ===== STEP 8: VERCEL DEPLOY (Same Repo) =====
    if (vercelToken) {
      logs.step(8, totalSteps, 'Deploying to Vercel');
      logs.emit('info', `Setting up Vercel project...`);

      // Update project to building status for Vercel deployment
      await updateProjectStatus(projectName, {
        status: 'building'
      });
      emitProjectUpdate(io, projectName, 'building', { step: 7 });

      const vercel = createVercelService(vercelToken);

      try {
        logs.emit('info', `Checking for existing Vercel project...`);

        let project;
        try {
          project = await vercel.getProject(originalRepoName);
        } catch (err) {
          logs.emit('warning', `getProject error: ${err.message}`);
          project = null;
        }

        if (!project) {
          logs.emit('info', `Creating Vercel project: ${originalRepoName}`);

          try {
            const createData = {
              name: originalRepoName,
              gitRepository: {
                type: 'github',
                repo: `${repoInfo?.owner || owner}/${originalRepoName}`
              }
            };

            project = await vercel.createProject(createData);
            logs.success(`Project created: vercel.com/dashboard`);

            try {
              logs.emit('info', `Linking project to GitHub...`);
              await vercel.request('POST', `/v1/projects/${project.id}/import`, {
                gitSource: {
                  type: 'github',
                  repo: `${repoInfo?.owner || owner}/${originalRepoName}`,
                  ref: targetBranch
                }
              });
              logs.emit('info', `Linked to GitHub`);
            } catch (linkErr) {
              logs.emit('warning', `GitHub link may require manual setup`);
            }
          } catch (createErr) {
            logs.error(`Failed to create Vercel project: ${createErr.message}`);
          }
        } else {
          logs.emit('info', `Using existing project: ${project.name}`);
        }

        if (!project) {
          logs.warning('Skipping Vercel deployment - no project available');
        } else {
          let repoId = null;
          try {
            logs.emit('info', `Getting GitHub repo ID...`);
            repoId = await github.getRepoId(repoInfo?.owner || owner, originalRepoName);
          } catch (err) {
            console.log(`[Pipeline:${sessionId}] Could not get repoId:`, err.message);
          }

          await new Promise(r => setTimeout(r, 5000));

          // Inject environment variables
          if (envVars.length > 0) {
            logs.emit('info', `Syncing ${envVars.length} environment variable(s)...`);

            const projectType = analysis.projectType.type;
            const isViteProject = projectType === PROJECT_TYPES.FRONTEND_FRAMEWORK;

            const envsObject = {};
            for (const envVar of envVars) {
              let key = envVar.key;
              let value = envVar.value;

              if (key === 'VITE_API_URL' && value.includes('localhost')) {
                value = '';
                logs.emit('info', `  Auto-cleared VITE_API_URL (using Vercel rewrites)`);
              } else if (key.startsWith('VITE_') && !isViteProject) {
                key = key.replace('VITE_', '');
                logs.emit('info', `  Stripped VITE_ prefix: ${envVar.key} -> ${key}`);
              } else if (isViteProject && !key.startsWith('VITE_') && !key.startsWith('NODE_') && !key.startsWith('REACT_')) {
                key = `VITE_${key}`;
                logs.emit('info', `  Auto-prefixed ${envVar.key} -> ${key}`);
              }

              envsObject[key] = value;
            }

            if (isViteProject && !envsObject.VITE_API_URL) {
              envsObject.VITE_API_URL = '';
              logs.emit('info', `  Added VITE_API_URL="" (for Vercel proxy)`);
            }

            await vercel.syncVercelEnvironment(project.id, vercelToken, envsObject);

            const expectedKeys = Object.keys(envsObject);
            const verification = await vercel.verifyEnvVars(project.id, expectedKeys, 5, 2000);

            if (verification.verified) {
              logs.emit('info', 'All environment variables confirmed by Vercel');
            } else {
              logs.emit('warning', `Missing vars: ${verification.missing.join(', ')}`);
            }
          }

          // Trigger deployment with streaming logs
          logs.emit('info', `Triggering deployment...`);

          try {
            const deploymentData = {
              name: originalRepoName,
              gitSource: {
                type: 'github'
              }
            };

            if (repoId) {
              deploymentData.gitSource.repoId = repoId;
              deploymentData.gitSource.ref = targetBranch;
            } else {
              deploymentData.gitSource.repo = `${repoInfo?.owner || owner}/${originalRepoName}`;
              deploymentData.gitSource.ref = targetBranch;
            }

            const deployment = await vercel.createDeployment(deploymentData);

            logs.emit('info', `Deployment queued: ${deployment.id}`);
            logs.emit('info', `Watch build progress: https://vercel.com/deployments/${deployment.id}`);

            // Stream build logs in real-time
            let buildLogs = [];

            const buildLogResult = await vercel.streamDeploymentLogs(
              deployment.id,
              (logEntry, rawEvent) => {
                let message = '';
                let level = 'info';

                if (logEntry.type === 'command-output' || rawEvent.payload?.type === 'command-output') {
                  message = rawEvent.payload?.text || logEntry.message;
                  if (message.includes('npm ERR') || message.includes('error')) {
                    level = 'error';
                  } else if (message.includes('warn')) {
                    level = 'warning';
                  }
                } else if (logEntry.type === 'error') {
                  message = `Build Error: ${logEntry.message}`;
                  level = 'error';
                } else if (rawEvent.payload?.text) {
                  message = rawEvent.payload.text;
                } else {
                  message = logEntry.message;
                }

                // Capture logs for AI analysis
                buildLogs.push({
                  timestamp: new Date(),
                  level,
                  message,
                  type: logEntry.type
                });

                if (message && message.trim()) {
                  logs.emit(level, message);
                }
              },
              { interval: 2000, maxAttempts: 90 }
            );

            // Check build result
            if (buildLogResult.complete) {
              if (buildLogResult.status === 'READY') {
                logs.success(`Live at: https://${buildLogResult.url}`);
                logs.success('===== Pipeline Complete =====');

                // Update project to live status
                await updateProjectStatus(projectName, {
                  status: 'live',
                  vercelUrl: `https://${buildLogResult.url}`,
                  lastDeployAt: new Date(),
                  lastWebhookAt: new Date()
                });
                emitProjectUpdate(io, projectName, 'live', {
                  url: `https://${buildLogResult.url}`
                });

                // Send success notification
                try {
                  const duration = buildLogResult.duration || 0;
                  await fetch(`${process.env.BACKEND_URL || 'http://localhost:5000'}/api/notify/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      projectName,
                      status: 'live',
                      duration,
                      url: `https://${buildLogResult.url}`
                    })
                  });
                } catch (notifyErr) {
                  console.log(`[Pipeline:${sessionId}] Notification failed: ${notifyErr.message}`);
                }

                return {
                  success: true,
                  repository: repoUrl,
                  branch: targetBranch,
                  project: originalRepoName,
                  deployment: `https://${buildLogResult.url}`
                };
              } else if (buildLogResult.status === 'ERROR') {
                logs.error('Vercel build failed');

                // Run AI diagnostic on failure
                const aiService = createAIService();
                const diagnosis = await aiService.diagnoseBuildFailure(buildLogs);

                let diagnosisText = null;
                if (diagnosis.success) {
                  diagnosisText = diagnosis.diagnosis;
                  logs.emit('info', `AI Diagnosis: ${diagnosis.diagnosis}`);

                  // Emit AI insight event for UI
                  io.to(sessionId).emit('ai-insight', {
                    type: 'diagnosis',
                    diagnosis: diagnosis.diagnosis,
                    issue: diagnosis.issue,
                    suggestion: diagnosis.suggestion,
                    confidence: diagnosis.confidence,
                    timestamp: new Date()
                  });

                  // Send notification with diagnosis
                  try {
                    const duration = buildLogResult.duration || 0;
                    await fetch(`${process.env.BACKEND_URL || 'http://localhost:5000'}/api/notify/send`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        projectName,
                        status: 'failed',
                        duration,
                        diagnosis: diagnosis.diagnosis
                      })
                    });
                  } catch (notifyErr) {
                    console.log(`[Pipeline:${sessionId}] Notification failed: ${notifyErr.message}`);
                  }
                } else {
                  logs.emit('warning', `AI diagnostic unavailable: ${diagnosis.error}`);
                }

                // Store diagnosis in project
                await updateProjectStatus(projectName, {
                  status: 'failed',
                  aiDiagnosis: diagnosisText
                });
                emitProjectUpdate(io, projectName, 'failed', { aiDiagnosis: diagnosisText });

                throw new Error('Vercel deployment failed');
              } else {
                logs.warning(`Deployment status: ${buildLogResult.status}`);
              }
            } else {
              logs.warning('Build log streaming timed out');
            }
          } catch (vercelError) {
            logs.error(`Vercel error: ${vercelError.message}`);
          }
        }
      } catch (err) {
        logs.error(`Vercel setup error: ${err.message}`);
      }
    }

    // Cleanup
    if (workDir && workDir.startsWith(os.tmpdir())) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }

    logs.success('===== Pipeline Complete =====', {
      repository: repoUrl,
      branch: targetBranch,
      project: originalRepoName
    });

    // Update project to live status (for non-Vercel deployments too)
    await updateProjectStatus(projectName, {
      status: 'live',
      lastDeployAt: new Date()
    });
    emitProjectUpdate(io, projectName, 'live');

    return {
      success: true,
      repository: repoUrl,
      branch: targetBranch,
      project: originalRepoName
    };

  } catch (error) {
    logs.error(`Pipeline failed: ${error.message}`);

    // Update project to failed status
    await updateProjectStatus(projectName, {
      status: 'failed'
    });
    emitProjectUpdate(io, projectName, 'failed');

    if (workDir && workDir.startsWith(os.tmpdir())) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }

    throw error;
  }
};

module.exports = { runTransformationPipeline };