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
const { architectAudit } = require('./architect');
const { refactorMovedFiles } = require('./refactor.service');
const { createAIRefactorService } = require('./aiRefactor');
const { executeMigration, cleanupEmptyDirs, verifyMigration } = require('../utils/repoManager');
const { splitPackageJson } = require('../utils/packageManager');

// Project persistence helper - ensures project exists and updates status
const updateProjectStatus = async (projectName, updates) => {
  try {
    await Project.findOneAndUpdate(
      { name: projectName },
      { ...updates, updatedAt: new Date(), status: updates.status || 'building' },
      { new: true, upsert: true }
    );
    console.log(`[Project] Updated: ${projectName} -> ${updates.status}`);
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

// ===== PHASE 1: REPOSITORY AUDITOR =====
// Deep crawl of the repo to map every path and configuration
async function deepAuditRepository(workDir) {
  const audit = {
    frontend: { path: '', buildScript: '', outDir: 'dist', framework: '' },
    backend: { path: '', entryFile: '', framework: '' },
    isMERN: false,
    allPackages: []
  };

  try {
    // Helper to check if file exists
    const fileExists = async (filePath) => {
      try {
        await fs.promises.access(filePath);
        return true;
      } catch {
        return false;
      }
    };

    // Recursively find all package.json files
    const findFiles = async (dir, pattern) => {
      const results = [];
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build', '.next', '.nuxt'].includes(entry.name)) {
              results.push(...await findFiles(fullPath, pattern));
            }
          } else if (entry.name.match(pattern)) {
            results.push(fullPath);
          }
        }
      } catch {}
      return results;
    };

    // Find all package.json files
    const packages = await findFiles(workDir, /package\.json$/);
    console.log(`[Audit] Found ${packages.length} package.json files`);

    for (const pkgPath of packages) {
      try {
        const content = await fs.promises.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(content);
        const dir = path.dirname(pkgPath);
        const relativeDir = path.relative(workDir, dir);
        const relativeDirForAudit = relativeDir === '' ? '.' : relativeDir;

        audit.allPackages.push({
          path: pkgPath,
          name: pkg.name || path.basename(dir),
          dir: relativeDirForAudit
        });

        // Identify Frontend (looking for Vite/React/Vue)
        const hasVite = pkg.dependencies?.vite || pkg.devDependencies?.vite;
        const hasReact = pkg.dependencies?.react;
        const hasVue = pkg.dependencies?.vue;
        const hasNext = pkg.dependencies?.next;

        if (hasVite || hasReact || hasVue) {
          audit.frontend.path = relativeDirForAudit === '.' ? 'frontend' : relativeDirForAudit;
          audit.frontend.buildScript = pkg.scripts?.build || (hasVite ? 'vite build' : 'npm run build');
          audit.frontend.framework = hasVite ? 'Vite' : (hasReact ? 'React' : 'Vue');

          // Detect output directory from vite.config.js
          const viteConfigPath = path.join(dir, 'vite.config.js');
          if (await fileExists(viteConfigPath)) {
            const viteConfig = await fs.promises.readFile(viteConfigPath, 'utf8');
            const outDirMatch = viteConfig.match(/outDir:\s*['"]([^'"]+)['"]/);
            if (outDirMatch) {
              audit.frontend.outDir = outDirMatch[1];
            }
            // Check for base path
            const baseMatch = viteConfig.match(/base:\s*['"]([^'"]+)['"]/);
            if (baseMatch) {
              audit.frontend.base = baseMatch[1];
            }
          }

          console.log(`[Audit] Frontend: ${audit.frontend.path}, framework: ${audit.frontend.framework}`);
        }

        // Identify Backend (looking for Express/Mongoose)
        const hasExpress = pkg.dependencies?.express;
        const hasMongoose = pkg.dependencies?.mongoose;
        const hasFastify = pkg.dependencies?.fastify;

        if (hasExpress || hasMongoose) {
          audit.backend.path = relativeDirForAudit === '.' ? 'backend' : relativeDirForAudit;
          audit.backend.framework = hasExpress ? 'Express' : (hasMongoose ? 'Mongoose' : 'Node');

          // Find the entry file (server.js, app.js, index.js)
          const possibleEntries = ['server.js', 'src/app.js', 'index.js', 'app.js', 'src/index.js'];
          for (const entry of possibleEntries) {
            const entryPath = path.join(workDir, audit.backend.path, entry);
            if (await fileExists(entryPath)) {
              audit.backend.entryFile = path.join(audit.backend.path, entry);
              break;
            }
          }

          console.log(`[Audit] Backend: ${audit.backend.path}, entry: ${audit.backend.entryFile}`);
        }
      } catch (e) {
        console.log(`[Audit] Skipping invalid package.json: ${pkgPath}`);
      }
    }

    // Determine if MERN
    audit.isMERN = !!(audit.frontend.path && audit.backend.path);

    console.log(`[Audit] === REPOSITORY MAP ===`);
    console.log(`  Frontend: ${audit.frontend.path || 'NOT FOUND'}`);
    console.log(`  Backend: ${audit.backend.path || 'NOT FOUND'}`);
    console.log(`  isMERN: ${audit.isMERN}`);
    console.log(`  Build: ${audit.frontend.buildScript}`);
    console.log(`  Output: ${audit.frontend.outDir}`);

  } catch (error) {
    console.error('[Audit] Error:', error.message);
  }

  return audit;
}

// Alias for backward compatibility
const analyzeRepository = deepAuditRepository;

// ===== PHASE 2: AI-DRIVEN CORRECTION =====
async function performAICorrection(workDir, discovery, logs) {
  const corrections = {
    viteBaseFixed: false,
    apiUrlsFixed: 0,
    errors: []
  };

  try {
    logs.emit('info', `Phase 2: Running AI-driven corrections...`);

    // Use audit structure from deepAuditRepository
    const frontendPath = discovery.frontend?.path || discovery.frontendPath || '';
    const backendPath = discovery.backend?.path || discovery.backendPath || '';

    // 1. Fix vite.config.js base path
    if (frontendPath) {
      const viteConfigPath = path.join(workDir, frontendPath, 'vite.config.js');
      if (fs.existsSync(viteConfigPath)) {
        let viteConfig = await fs.promises.readFile(viteConfigPath, 'utf8');
        const hasCustomBase = viteConfig.includes('base:');

        if (hasCustomBase) {
          // Replace any existing base with base: '/'
          viteConfig = viteConfig.replace(/base:\s*['"][^'"]*['"]/g, "base: '/'");
          await fs.promises.writeFile(viteConfigPath, viteConfig);
          corrections.viteBaseFixed = true;
          logs.emit('info', `Fixed vite.config.js base path to '/'`);
        } else {
          logs.emit('info', `vite.config.js already has correct base '/'`);
        }
      }
    }

    // 2. Fix API URLs (localhost -> environment variables)
    const fixApiUrls = async (dir, isFrontend) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      let fixed = 0;

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            fixed += await fixApiUrls(fullPath, isFrontend);
          }
        } else if (entry.name.match(/\.(js|jsx|ts|tsx)$/)) {
          let content = await fs.promises.readFile(fullPath, 'utf8');
          let originalContent = content;

          // Replace localhost URLs with environment variables
          content = content.replace(/['"]http:\/\/localhost:(\d+)[^'"]*['"]/g, (match, port) => {
            if (port === '3000') {
              return "'process.env.API_URL'";
            }
            return isFrontend ? "import.meta.env.VITE_API_URL" : "process.env.API_URL";
          });

          if (content !== originalContent) {
            await fs.promises.writeFile(fullPath, content);
            fixed++;
          }
        }
      }
      return fixed;
    };

    // Fix frontend URLs
    if (frontendPath) {
      const frontendDir = path.join(workDir, frontendPath);
      if (fs.existsSync(frontendDir)) {
        corrections.apiUrlsFixed += await fixApiUrls(frontendDir, true);
      }
    }

    // Fix backend URLs
    if (backendPath) {
      const backendDir = path.join(workDir, backendPath);
      if (fs.existsSync(backendDir)) {
        corrections.apiUrlsFixed += await fixApiUrls(backendDir, false);
      }
    }

    logs.emit('info', `API URLs corrected: ${corrections.apiUrlsFixed} files`);

    // 3. Verify index.html exists in frontend root
    if (frontendPath) {
      const indexHtmlPath = path.join(workDir, frontendPath, 'index.html');
      if (fs.existsSync(indexHtmlPath)) {
        logs.emit('info', `index.html verified at ${frontendPath}/`);
      } else {
        corrections.errors.push('index.html not found in frontend root');
        logs.emit('warning', `index.html NOT found in ${frontendPath}/`);
      }
    }

  } catch (error) {
    console.error('[AI Correction] Error:', error.message);
    corrections.errors.push(error.message);
  }

  return corrections;
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

// ===== STEP 3: TRANSMUTATION (Source Code Fixer) =====
async function transmuteSourceCode(projectPath, discovery = {}) {
  const getFiles = async (dir) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map((res) => {
      const fullPath = path.resolve(dir, res.name);
      return res.isDirectory() ? getFiles(fullPath) : fullPath;
    }));
    return Array.prototype.concat(...files).filter(f => f.match(/\.(js|jsx|ts|tsx)$/));
  };

  const files = await getFiles(projectPath);
  let totalModified = 0;

  // Use audit structure from deepAuditRepository
  const frontendDir = discovery.frontend?.path || discovery.frontendPath || 'frontend';
  const backendDir = discovery.backend?.path || discovery.backendPath || 'backend';

  for (const file of files) {
    let content = await fs.promises.readFile(file, 'utf8');
    const originalContent = content;

    // Check if this file is in the frontend or backend directory
    const normalizedPath = file.replace(/\\/g, '/');
    const isFrontend = normalizedPath.includes(`/${frontendDir}/`) || normalizedPath.endsWith(`/${frontendDir}`);
    const isBackend = normalizedPath.includes(`/${backendDir}/`) || normalizedPath.endsWith(`/${backendDir}`);

    // Replace localhost URLs with appropriate environment variables
    content = content.replace(/['"]http:\/\/localhost:(\d+)[^'"]*['"]/g, (match, port) => {
      if (port === '3000') {
        return "'process.env.API_URL'";
      }
      // Use VITE_ prefix for frontend, NODE_ for backend
      return isFrontend ? 'import.meta.env.VITE_API_URL' : 'process.env.API_URL';
    });

    if (content !== originalContent) {
      await fs.promises.writeFile(file, content);
      const syntax = isFrontend ? 'VITE' : 'NODE';
      console.log(`[Transmute] ${syntax} syntax applied to: ${path.basename(file)}`);
      totalModified++;
    }
  }

  return { filesModified: totalModified, fixes: [] };
}

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

  // Generate target branch name - shadow branch for standardized deployment
  const targetBranch = `devops-standardized-${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 6)}`;

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

    // ===== PHASE 1: AI ARCHITECT MASTER AUDIT =====
    logs.emit('info', `Phase 1: AI Master Audit starting...`);

    // Run the full architect audit (structure + packages + configs + source)
    const masterAudit = await architectAudit(workDir);

    // Run the deep audit for path detection
    const discovery = await deepAuditRepository(workDir);

    // Combine both audits
    const fullAudit = {
      ...masterAudit,
      ...discovery,
      architectRecommendations: masterAudit.recommendations
    };

    logs.emit('info', `Files mapped: ${masterAudit.structure.split('\n').length}`);
    logs.emit('info', `Packages found: ${masterAudit.packages.length}`);

    if (discovery.frontend.path) {
      logs.emit('info', `Frontend Heart: ${discovery.frontend.path}`);
      logs.emit('info', `Framework: ${discovery.frontend.framework}`);
      logs.emit('info', `Build: cd ${discovery.frontend.path} && ${discovery.frontend.buildScript}`);
      logs.emit('info', `Output: ${discovery.frontend.path}/${discovery.frontend.outDir}`);
    }
    if (discovery.backend.path) {
      logs.emit('info', `Backend Heart: ${discovery.backend.path}`);
      logs.emit('info', `Entry: ${discovery.backend.entryFile || 'auto-detect'}`);
    }
    logs.emit('info', `isMERN: ${discovery.isMERN}`);

    // Log AI recommendations
    if (masterAudit.recommendations.length > 0) {
      logs.emit('info', `AI Recommendations:`);
      masterAudit.recommendations.forEach(rec => {
        logs.emit('info', `  - ${rec}`);
      });
    }

    // ===== PHASE 1.5: AI MIGRATION PLANNER =====
    logs.emit('info', `Phase 1.5: AI generating MigrationPlan...`);

    const aiService = createAIService();
    const migrationPlanResult = await aiService.generateMigrationPlan(
      masterAudit.structure,
      masterAudit.packages
    );

    if (migrationPlanResult.success && migrationPlanResult.plan) {
      logs.emit('info', `MigrationPlan: ${migrationPlanResult.movesCount} file moves`);

      // ===== PHASE 1.5.5: ATOMIC FILE MIGRATION =====
      // Use the Atomic Mover (repoManager) instead of ai.service's version
      const atomicResults = await executeMigration(workDir, migrationPlanResult.plan.moves, logs);
      logs.emit('info', `Atomic Move: ${atomicResults.moved} moved, ${atomicResults.skipped} skipped, ${atomicResults.failed} failed`);

      // Cleanup empty directories left behind
      await cleanupEmptyDirs(workDir);

      // Verify migration
      const verification = await verifyMigration(workDir, migrationPlanResult.plan.moves);
      if (verification.valid) {
        logs.emit('info', `Migration verified: all ${verification.found.length} files in place`);
      } else {
        logs.emit('warning', `Migration incomplete: ${verification.missing.length} files missing`);
      }

      // ===== PHASE 1.8: DEPENDENCY SPLITTER =====
      logs.emit('info', `Phase 1.8: Splitting package.json for MERN deployment...`);

      const splitResult = await splitPackageJson(workDir);
      if (splitResult.success && !splitResult.alreadySplit) {
        const frontendDeps = Object.keys(splitResult.frontend || {}).length;
        const backendDeps = Object.keys(splitResult.backend || {}).length;
        logs.emit('info', `Dependencies split: ${frontendDeps} frontend, ${backendDeps} backend`);
      } else if (splitResult.alreadySplit) {
        logs.emit('info', `Dependencies already split`);
      } else {
        logs.emit('warning', `Dependency split skipped: ${splitResult.error}`);
      }

      // Execute refactor files (remove app.listen, etc.)
      if (migrationPlanResult.plan.refactorFiles?.length > 0) {
        logs.emit('info', `Refactoring ${migrationPlanResult.plan.refactorFiles.length} server files...`);
        const refactorResults = await aiService.executeMigrationPlan(workDir, {
          refactorFiles: migrationPlanResult.plan.refactorFiles
        }, logs);
        logs.emit('info', `Refactor: ${refactorResults.refactored} refactored, ${refactorResults.failed} failed`);
      }

      // ===== PHASE 1.75: AI REFACTOR LOOP (Surgical Re-Wiring) =====
      if (migrationPlanResult.plan?.refactorFiles?.length > 0) {
        logs.emit('info', `Phase 1.75: AI Surgical Refactor (${migrationPlanResult.plan.refactorFiles.length} files)...`);

        const aiRefactor = createAIRefactorService();
        const refactorList = migrationPlanResult.plan.refactorFiles.map(f => path.join(workDir, f));

        const surgicalResults = await aiRefactor.batchRefactor(refactorList, migrationPlanResult.plan, logs);
        logs.emit('info', `Surgical Refactor: ${surgicalResults.refactored} fixed, ${surgicalResults.skipped} no-change, ${surgicalResults.failed} failed`);

        if (surgicalResults.failed > 0) {
          logs.emit('warning', `Some surgical rewiring failed: ${surgicalResults.errors.join(', ')}`);
        }
      } else {
        logs.emit('info', `Phase 1.75: No files require surgical re-wiring`);
      }
    } else if (!migrationPlanResult.success && migrationPlanResult.error) {
      logs.emit('info', `AI MigrationPlan skipped: ${migrationPlanResult.error}`);
      // Fallback: Use standard MERN structure if AI fails
      logs.emit('info', `Using fallback MERN structure (AI unavailable)...`);
      migrationPlanResult.plan = {
        moves: [],
        refactorFiles: ['backend/server.js', 'backend/src/app.js'],
        outputDir: 'frontend/dist',
        buildCommand: 'cd frontend && npm install && npm run build',
        package_strategy: 'ALREADY_SEPARATE'
      };
      migrationPlanResult.success = true;
      migrationPlanResult.movesCount = 0;
    }

    // ===== PHASE 2: AI-ASSISTED BRANCH SURGERY =====
    logs.emit('info', `Phase 2: AI analyzing audit map for surgery...`);

    const surgeryResult = await aiService.performBranchSurgery(discovery);

    if (surgeryResult.success && surgeryResult.instructions?.length > 0) {
      logs.emit('info', `AI generated ${surgeryResult.count} surgical instructions`);

      // Execute the surgery
      const surgeryExecution = await aiService.executeSurgery(workDir, surgeryResult.instructions, logs);
      logs.emit('info', `Surgery complete: ${surgeryExecution.applied} applied, ${surgeryExecution.failed} failed`);

      if (surgeryExecution.failed > 0) {
        logs.emit('warning', `Some surgical changes could not be applied`);
      }
    } else if (!surgeryResult.success && surgeryResult.error) {
      logs.emit('warning', `AI surgery skipped: ${surgeryResult.error}`);
      // Apply basic surgery rules without AI
      logs.emit('info', `Applying rule-based corrections instead...`);
    } else {
      logs.emit('info', `No surgical corrections needed`);
    }

    // Also run the rule-based corrections as backup
    const aiCorrections = await performAICorrection(workDir, discovery, logs);
    if (aiCorrections.errors.length > 0) {
      logs.emit('warning', `Rule-based corrections had issues: ${aiCorrections.errors.join(', ')}`);
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
    logs.emit('info', `Scanning for localhost patterns in discovered folders...`);

    // Use discovery to target specific folders for transmutation
    const transmutationResults = await transmuteSourceCode(workDir, discovery);

    logs.success(`Transmuted ${transmutationResults.filesModified} files`);

    // Update project status after transmutation
    await updateProjectStatus(projectName, {
      status: 'building'
    });
    emitProjectUpdate(io, projectName, 'building', { step: 3 });

    // ===== STEP 4: TRANSFORMATION =====
    logs.step(4, totalSteps, 'Generating deployment files');
    logs.emit('info', `Creating vercel.json...`);

    // Pass full audit to transformer for intelligent config generation
    const transformResult = await transformForDeployment(workDir, analysis.projectType.type, {
      includeNowJson: options.includeNowJson || false,
      discovery: fullAudit  // Use full AI audit for accurate vercel.json
    });

    logs.success(`Created ${transformResult.files.length} deployment files`);

    // Log directory structure for debugging
    const listDir = async (dir, prefix = '') => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
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

    // Use user's project name for Vercel (sanitize for URL safety)
    const vercelProjectName = projectName.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 40);
    const originalRepoName = repoInfo ? repoInfo.repo : vercelProjectName;
    const repoUrl = repoInfo ? repoInfo.url : projectPath;

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Push code to NEW BRANCH in SAME REPO
    logs.emit('info', `Pushing to ${targetBranch} branch in original repo...`);
    // Build authenticated URL: https://github.com/owner/repo -> https://x-access-token:TOKEN@github.com/owner/repo
    const cleanRepoUrl = repoUrl.replace(/\.git\/?$/, '').replace(/\/+$/, '');
    const remoteUrl = cleanRepoUrl.replace('://', `://x-access-token:${githubToken}@`);

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

      logs.emit('info', `Git add...`);
      await git.add('.');  // Add all files
      // Explicitly add frontend and backend for MERN deployments
      await git.add('frontend').catch(() => {});  // Ignore if not exists
      await git.add('backend').catch(() => {});    // Ignore if not exists
      await git.add('api').catch(() => {});        // Ignore if not exists (created by AI or skipped)
      await git.add('vercel.json');               // Add vercel config

      // Fallback: ensure api folder exists for serverless bridge
      const apiDir = path.join(workDir, 'api');
      if (!fs.existsSync(apiDir)) {
        logs.emit('info', `Creating api/ folder for serverless bridge...`);
        fs.mkdirSync(apiDir, { recursive: true });
        // Create basic serverless bridge
        fs.writeFileSync(path.join(apiDir, 'index.js'),
          `// Serverless bridge\nconst app = require('../backend/src/app');\nmodule.exports = async (req, res) => app(req, res);\n`
        );
      }

      logs.emit('info', `Staged frontend/, backend/, api/, and vercel.json`);

      logs.emit('info', `Git commit...`);
      await git.commit('AI-Standardized MERN deployment via DevOps Panel');
      logs.emit('info', `Created shadow branch: ${targetBranch} (never touches main)`);

      logs.emit('info', `Creating ${targetBranch} shadow branch...`);
      logs.emit('info', `(Isolated branch - main code is untouched)`);

      await git.branch(['-m', 'HEAD', targetBranch]).catch(() => {
        return git.checkoutLocalBranch(targetBranch);
      });

      logs.emit('info', `Git push ${targetBranch} shadow branch to original repo...`);

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

      logs.success(`Standardized code pushed to ${targetBranch} shadow branch`);
      logs.emit('info', `Original repo: ${repoUrl}`);
      logs.emit('info', `(Main branch is untouched - all changes in isolated shadow branch)`);

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
        logs.emit('info', `Checking for existing Vercel project: ${vercelProjectName}...`);

        let project;
        try {
          project = await vercel.getProject(vercelProjectName);  // Use user's project name
        } catch (err) {
          logs.emit('info', `No existing project with name: ${vercelProjectName}`);
          project = null;
        }

        if (!project) {
          logs.emit('info', `Creating Vercel project: ${vercelProjectName}`);

          try {
            const createData = {
              name: vercelProjectName,  // Use user's project name
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
            const projectType = analysis.projectType.type;
            // Detect frontend folder for correct output directory
            const hasFrontendFolder = fs.existsSync(path.join(workDir, 'frontend')) ||
                                      fs.existsSync(path.join(workDir, 'client'));
            const outputDir = hasFrontendFolder ? 'frontend/dist' : 'dist';

            const deploymentData = {
              name: vercelProjectName,  // Use user's project name for Vercel
              projectId: project.id,  // Link to existing project
              gitSource: {
                type: 'github'
              },
              // For MERN/frontend projects, set output directory
              ...(projectType === 'MERN' && {
                outputDirectory: outputDir
              })
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

                // Update project to live status and save Vercel details
                await updateProjectStatus(projectName, {
                  status: 'live',
                  vercelUrl: `https://${buildLogResult.url}`,
                  vercelProjectId: project?.id,
                  lastDeployAt: new Date(),
                  lastWebhookAt: new Date()
                });
                emitProjectUpdate(io, projectName, 'live', {
                  url: `https://${buildLogResult.url}`
                });

                // Update project to live status
                await updateProjectStatus(projectName, {
                  status: 'live',
                  vercelUrl: `https://${buildLogResult.url}`,
                  lastDeployAt: new Date()
                });
                emitProjectUpdate(io, projectName, 'live', { url: `https://${buildLogResult.url}` });

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
                  project: vercelProjectName,  // Use user's project name
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
      project: vercelProjectName  // Use user's project name
    });

    // Don't update to 'live' here - only successful Vercel build updates to 'live'
    // This prevents "live" being shown when deployment actually failed

    return {
      success: true,
      repository: repoUrl,
      branch: targetBranch,
      project: vercelProjectName  // Use user's project name
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