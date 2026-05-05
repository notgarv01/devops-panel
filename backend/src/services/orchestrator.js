const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const simpleGit = require('simple-git');
const { analyzeProject, PROJECT_TYPES } = require('../utils/analyzer');
const { transformForDeployment } = require('../utils/transformer');
const { createGitHubService } = require('./github.service');
const { createVercelService } = require('./vercel.service');

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
  // Clean up if exists
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Build branch priority: explicit branch first, then main/master/default
  const branchPriority = preferredBranch
    ? [preferredBranch, ...['main', 'master'].filter(b => b !== preferredBranch)]
    : ['main', 'master'];

  const git = simpleGit();

  // Try each branch in priority order
  for (const branch of branchPriority) {
    try {
      await git.clone(repoUrl, targetDir, ['--branch', branch, '--single-branch', '--depth', '1']);
      const actualGit = simpleGit(targetDir);
      const branchOutput = (await actualGit.branch()).current;
      return { success: true, path: targetDir, branch: branchOutput || branch };
    } catch (error) {
      // Branch not found, try next one
      continue;
    }
  }

  // If all specific branches fail, try cloning without branch spec (gets default)
  try {
    await git.clone(repoUrl, targetDir, ['--depth', '1']);
    const actualGit = simpleGit(targetDir);
    const branchOutput = (await actualGit.branch()).current;
    return { success: true, path: targetDir, branch: branchOutput || 'default' };
  } catch (error) {
    return { success: false, error: 'Could not clone repository. Please check the URL and your access permissions.' };
  }
};

// Check if string is a GitHub URL
const isGitHubUrl = (str) => {
  return str && (str.includes('github.com') || str.startsWith('https://'));
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

  const totalSteps = vercelToken ? 5 : 4;
  let workDir = null;

  try {
    logs.emit('info', `Starting pipeline for: ${projectName}`);

    // ===== STEP 1: CLONE OR ACCESS =====
    logs.step(1, totalSteps, 'Fetching project code');

    // Capture the actual branch that was cloned
    let actualBranch = branch || 'main';

    if (isGitHubUrl(projectPath)) {
      // Clone from GitHub URL
      workDir = path.join(os.tmpdir(), `pipeline-${sessionId}`);
      logs.emit('info', `Cloning from GitHub...`);

      const cloneResult = await cloneRepo(projectPath, workDir, branch);
      if (!cloneResult.success) {
        throw new Error(`Clone failed: ${cloneResult.error}`);
      }
      actualBranch = cloneResult.branch; // Use the actual branch that was cloned

      // Remove .git folder to avoid history conflicts when pushing to new repo
      const gitDir = path.join(workDir, '.git');
      if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, { recursive: true, force: true });
      }

      logs.success(`Repository cloned (${actualBranch} branch) to ${workDir}`);
    } else {
      // Use local path directly
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

    // ===== STEP 3: TRANSFORMATION =====
    logs.step(3, totalSteps, 'Transforming code for Vercel');
    logs.emit('info', `Generating deployment files...`);

    const transformResult = await transformForDeployment(workDir, analysis.projectType.type, {
      includeNowJson: options.includeNowJson || false
    });

    logs.success(`Created ${transformResult.files.length} deployment files`);
    transformResult.files.forEach(f => {
      logs.emit('info', `  + ${path.relative(workDir, f)}`);
    });

    // Log directory structure for debugging
    const listDir = async (dir, prefix = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries.slice(0, 20)) { // Limit to 20 entries
          logs.emit('info', `  ${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`);
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            await listDir(path.join(dir, entry.name), prefix + '  ');
          }
        }
      } catch {}
    };
    logs.emit('info', `Directory structure:`);
    await listDir(workDir);

    // Log vercel.json content for debugging
    const vercelJsonPath = path.join(workDir, 'vercel.json');
    if (fs.existsSync(vercelJsonPath)) {
      const vercelContent = fs.readFileSync(vercelJsonPath, 'utf8');
      logs.emit('info', `vercel.json content: ${vercelContent}`);
    }

    // Log detailed transformations
    if (transformResult.serverTransformed) {
      if (transformResult.serverTransformed.moved) {
        logs.emit('info', `  → Moved server to api/index.js`);
      }
      if (transformResult.serverTransformed.transformed) {
        logs.emit('info', `  → Added module.exports = app`);
      }
    }

    // ===== STEP 4: GITHUB SYNC =====
    logs.step(4, totalSteps, 'Syncing to GitHub');
    logs.emit('info', `Authenticating with GitHub...`);

    const github = createGitHubService(githubToken);
    const user = await github.getAuthenticatedUser();
    const owner = user.login;

    logs.emit('info', `Authenticated as: ${user.name || owner}`);

    // Create new repository
    let repo;
    const cleanName = projectName.replace(/[^a-zA-Z0-9-_]/g, '-');

    try {
      repo = await github.createRepository({
        name: cleanName,
        description: `Deployed via DevOps Panel - ${analysis.projectType.type}`,
        isPrivate: options.private !== false,
        autoInit: false
      });
      logs.success(`Repository created: ${repo.html_url}`);
    } catch (error) {
      if (error.message && error.message.includes('already exists')) {
        repo = await github.getRepository(owner, cleanName);
        logs.warning('Repository already exists');
      } else {
        throw error;
      }
    }

    // Helper for Node.js-based delays (Windows-compatible)
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Push code to new repo using simple-git (cross-platform)
    logs.emit('info', `Pushing to GitHub...`);
    const remoteUrl = repo.clone_url.replace('https://', `https://x-access-token:${githubToken}@`);

    try {
      const git = simpleGit(workDir);

      logs.emit('info', `Git init...`);
      await git.init();

      logs.emit('info', `Git config...`);
      await git.addConfig('user.email', 'panel@devops.local', false, 'local');
      await git.addConfig('user.name', 'DevOps Panel', false, 'local');

      // Bulletproof Git settings for GitHub transfer
      await git.addConfig('http.postBuffer', '524288000', false, 'local');
      await git.addConfig('core.compression', '0', false, 'local');

      // Ensure node_modules is in .gitignore
      const gitignorePath = path.join(workDir, '.gitignore');
      const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
      if (!gitignoreContent.includes('node_modules')) {
        fs.writeFileSync(gitignorePath, gitignoreContent + '\nnode_modules/\n');
      }

      // Force sync file system to ensure all files are written to disk
      fs.sync && fs.sync();

      logs.emit('info', `Git add...`);
      await git.add('.');

      // Explicitly add vercel.json to ensure it's staged
      const vercelJsonPath = path.join(workDir, 'vercel.json');
      if (fs.existsSync(vercelJsonPath)) {
        await git.add('vercel.json');
        logs.emit('info', `Staged vercel.json`);
      }

      logs.emit('info', `Git commit...`);
      await git.commit('Deploy via DevOps Panel');

      logs.emit('info', `Git push (may take a moment)...`);

      // Push with retries
      let pushSuccess = false;
      let pushError = null;

      for (let attempt = 1; attempt <= 3 && !pushSuccess; attempt++) {
        try {
          if (attempt === 1) await delay(500);

          // Set remote (remove existing if present, then add new)
          try {
            const remotes = await git.getRemotes();
            if (remotes.some(r => r.name === 'origin')) {
              await git.removeRemote('origin');
            }
          } catch {}
          await git.addRemote('origin', remoteUrl);

          await git.push(['-u', 'origin', actualBranch, '--force']);
          pushSuccess = true;
        } catch (pushErr) {
          pushError = pushErr;
          if (attempt < 3) {
            console.log(`[Pipeline:${sessionId}] Push attempt ${attempt} failed: ${pushErr.message.substring(0, 100)}`);
            await delay(attempt * 3000);
          }
        }
      }

      // If push still fails, try alternative approach
      if (!pushSuccess) {
        console.log(`[Pipeline:${sessionId}] Standard push failed, trying alternative...`);
        try {
          // Remove .git and re-init with fs (Windows-safe)
          const gitDir = path.join(workDir, '.git');
          if (fs.existsSync(gitDir)) {
            fs.rmSync(gitDir, { recursive: true, force: true });
          }

          const altGit = simpleGit(workDir);
          await altGit.init();
          await altGit.addConfig('user.email', 'panel@devops.local', false, 'local');
          await altGit.addConfig('user.name', 'DevOps Panel', false, 'local');
          await altGit.add('.');
          await altGit.commit('Deploy via DevOps Panel');

          // Add remote with name origin2 (since origin won't exist after fresh init)
          await altGit.addRemote('origin2', remoteUrl);
          await altGit.push(['-u', 'origin2', actualBranch]);
          pushSuccess = true;
        } catch (altErr) {
          console.error(`[Pipeline:${sessionId}] Alternative push also failed: ${altErr.message}`);
          throw new Error(`Git push failed: ${pushError?.message || altErr.message}`);
        }
      }

      console.log(`[Pipeline:${sessionId}] Git push done`);
    } catch (gitError) {
      console.error(`[Pipeline:${sessionId}] Git error:`, gitError.message);
      throw new Error(`Git push failed: ${gitError.message}`);
    }

    logs.success(`Code pushed to ${actualBranch} branch`);
    console.log(`[Pipeline:${sessionId}] Git sync complete, checking Vercel step`);

    // ===== STEP 5: VERCEL DEPLOY =====
    if (vercelToken) {
      logs.emit('info', `Setting up Vercel project...`);
      console.log(`[Pipeline:${sessionId}] Vercel step starting`);
      logs.step(5, totalSteps, 'Deploying to Vercel');
      logs.emit('info', `Setting up Vercel project...`);

      const vercel = createVercelService(vercelToken);

      try {
        logs.emit('info', `Checking for existing Vercel project...`);
        console.log(`[Pipeline:${sessionId}] Calling vercel.getProject(${cleanName})`);

        // Verify/create project
        let project;
        try {
          project = await vercel.getProject(cleanName);
          console.log(`[Pipeline:${sessionId}] getProject returned:`, project ? 'project found' : 'null');
        } catch (err) {
          console.log(`[Pipeline:${sessionId}] getProject error:`, err.message);
          logs.emit('warning', `getProject error: ${err.message}`);
          project = null;
        }

        console.log(`[Pipeline:${sessionId}] Vercel getProject result:`, project);

        if (!project) {
          logs.emit('info', `Creating Vercel project: ${cleanName}`);

          // Don't specify framework for generic Node.js APIs
          // Vercel will auto-detect based on vercel.json
          console.log(`[Pipeline:${sessionId}] Creating without explicit framework`);
          console.log(`[Pipeline:${sessionId}] Calling vercel.createProject()`);

          try {
            const createData = {
              name: cleanName,
              gitRepository: {
                type: 'github',
                repo: `${owner}/${cleanName}`
              }
            };
            console.log(`[Pipeline:${sessionId}] createProject payload:`, JSON.stringify(createData));

            project = await vercel.createProject(createData);
            console.log(`[Pipeline:${sessionId}] createProject returned:`, JSON.stringify(project).substring(0, 200));
            logs.success(`Project created: vercel.com/dashboard`);

            // Link to GitHub after project creation
            try {
              logs.emit('info', `Linking project to GitHub...`);
              const repoFullName = `${owner}/${cleanName}`;
              console.log(`[Pipeline:${sessionId}] Linking to GitHub repo: ${repoFullName}`);

              // Use the import Git provider API to link the project
              await vercel.request('POST', `/v1/projects/${project.id}/import`, {
                gitSource: {
                  type: 'github',
                  repo: repoFullName,
                  ref: actualBranch
                }
              });
              logs.emit('info', `Linked to GitHub`);
            } catch (linkErr) {
              console.log(`[Pipeline:${sessionId}] GitHub link warning:`, linkErr.message);
              logs.emit('warning', `GitHub link may require manual setup`);
            }
          } catch (createErr) {
            console.error(`[Pipeline:${sessionId}] createProject error:`, createErr.message);
            console.error(`[Pipeline:${sessionId}] createProject error details:`, createErr.details);
            logs.error(`Failed to create Vercel project: ${createErr.message}`);
            // Continue without Vercel - GitHub sync already succeeded
          }
        } else {
          logs.emit('info', `Using existing project: ${project.name}`);
        }

        // Only continue if project was created/exists
        if (!project) {
          logs.warning('Skipping Vercel deployment - no project available');
        } else {
          // Get GitHub repo ID for Vercel deployment
          let repoId = null;
          try {
            logs.emit('info', `Getting GitHub repo ID...`);
            repoId = await github.getRepoId(owner, cleanName);
            console.log(`[Pipeline:${sessionId}] GitHub repoId: ${repoId}`);
          } catch (err) {
            console.log(`[Pipeline:${sessionId}] Could not get repoId:`, err.message);
          }

          // Wait for project to be fully ready (increased to 5s for env vars)
          await new Promise(r => setTimeout(r, 5000));

          // Inject environment variables with retry logic
          if (envVars.length > 0) {
            logs.emit('info', `Setting ${envVars.length} environment variable(s)...`);

            for (const envVar of envVars) {
              let retries = 3;
              while (retries > 0) {
                try {
                  await vercel.addEnvVar(project.id, {
                    key: envVar.key,
                    value: envVar.value,
                    target: 'production',
                    type: 'secret'
                  });
                  logs.emit('info', `  + ${envVar.key}`);
                  break;
                } catch (err) {
                  retries--;
                  if (retries === 0) {
                    logs.emit('warning', `  Failed to set ${envVar.key}`);
                  } else {
                    logs.emit('info', `  Retrying ${envVar.key}...`);
                    await new Promise(r => setTimeout(r, 2000));
                  }
                }
              }
            }
          }

          // Trigger deployment
          logs.emit('info', `Triggering deployment...`);

          try {
            const deploymentData = {
              name: cleanName,
              gitSource: {
                type: 'github'
              }
            };

            // Add repoId if available
            if (repoId) {
              deploymentData.gitSource.repoId = repoId;
              deploymentData.gitSource.ref = actualBranch;
            } else {
              // Fallback without repoId
              deploymentData.gitSource.repo = `${owner}/${cleanName}`;
              deploymentData.gitSource.ref = actualBranch;
            }

            const deployment = await vercel.createDeployment(deploymentData);

            logs.emit('info', `Deployment queued: ${deployment.id}`);

            // Poll for completion
            for (let i = 0; i < 30; i++) {
              await new Promise(r => setTimeout(r, 5000));

              const status = await vercel.getDeployment(deployment.id);
              const { readyState } = status;

              logs.emit('info', `Status: ${readyState}`);

              if (readyState === 'READY') {
                logs.success(`Live at: https://${status.url}`);
                logs.success('===== Pipeline Complete =====');
                return {
                  success: true,
                  repository: repo.html_url,
                  project: cleanName,
                  deployment: status.url
                };
              }

              if (readyState === 'ERROR') {
                throw new Error('Vercel deployment failed');
              }
            }

            logs.warning('Deployment polling timed out, check Vercel dashboard');
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
      repository: repo.html_url,
      project: cleanName
    });

    return {
      success: true,
      repository: repo.html_url,
      project: cleanName
    };

  } catch (error) {
    logs.error(`Pipeline failed: ${error.message}`);

    // Cleanup on error
    if (workDir && workDir.startsWith(os.tmpdir())) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }

    throw error;
  }
};

module.exports = { runTransformationPipeline };