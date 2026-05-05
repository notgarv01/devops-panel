const fs = require('fs').promises;
const path = require('path');

const PROJECT_TYPES = {
  STATIC: 'STATIC',
  NODE_API: 'NODE_API',
  FRONTEND_FRAMEWORK: 'FRONTEND_FRAMEWORK'
};

const BACKEND_SIGNALS = ['express', 'mongoose', 'koa', 'fastify', 'hapi', 'nestjs', 'sails', 'feathers'];
const FRONTEND_SIGNALS = ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'remix', 'astro'];
const FRAMEWORK_SIGNALS = ['@vitejs/plugin-react', '@vitejs/plugin-vue', 'vite', 'webpack', 'parcel', 'rollup'];

// Ignore these directories to prevent hangs
const IGNORE_DIRS = ['node_modules', '.git', 'dist', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv'];

const hasFile = async (dir, filename) => {
  try {
    await fs.access(path.join(dir, filename));
    return true;
  } catch {
    return false;
  }
};

const readJsonFile = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const scanDirectory = async (dir, extensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.html'], maxDepth = 3) => {
  const results = {
    files: [],
    directories: [],
    totalFiles: 0
  };

  const scan = async (currentDir, depth = 0) => {
    if (depth > maxDepth) return;
    if (results.totalFiles > 500) return; // Cap at 500 files

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORE_DIRS.includes(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          results.directories.push(path.relative(dir, fullPath));
          await scan(fullPath, depth + 1);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.files.push(path.relative(dir, fullPath));
            results.totalFiles++;
          }
        }
      }
    } catch (err) {
      // Silently ignore permission errors
    }
  };

  await scan(dir);
  return results;
};

// Find all package.json files in subdirectories
const findPackageJsons = async (dir, maxDepth = 3) => {
  const results = [];

  const scan = async (currentDir, depth = 0) => {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORE_DIRS.includes(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await scan(fullPath, depth + 1);
        } else if (entry.name === 'package.json') {
          results.push(path.relative(dir, fullPath));
        }
      }
    } catch {}
  };

  await scan(dir);
  return results;
};

exports.scanProject = async (workDir) => {
  const structure = await scanDirectory(workDir);
  const hasPackageJson = await hasFile(workDir, 'package.json');
  const hasIndexHtml = await hasFile(workDir, 'index.html');
  const hasIndexJs = await hasFile(workDir, 'index.js');

  let packageInfo = null;
  if (hasPackageJson) {
    packageInfo = await readJsonFile(path.join(workDir, 'package.json'));
  }

  return {
    structure,
    hasPackageJson,
    hasIndexHtml,
    hasIndexJs,
    packageInfo
  };
};

exports.detectProjectType = async (workDir) => {
  const scan = await this.scanProject(workDir);
  const { hasPackageJson, hasIndexHtml, hasIndexJs, packageInfo } = scan;

  // RULE 1: STATIC - index.html exists but no package.json
  if (hasIndexHtml && !hasPackageJson) {
    return {
      type: PROJECT_TYPES.STATIC,
      confidence: 1.0,
      signals: ['index.html found', 'no package.json'],
      reasoning: 'Pure static site with HTML entry point'
    };
  }

  // RULE 2: NODE_API - package.json contains backend signals
  if (hasPackageJson && packageInfo) {
    const deps = {
      ...(packageInfo.dependencies || {}),
      ...(packageInfo.devDependencies || {})
    };

    const allDeps = Object.keys(deps).map(d => d.toLowerCase());
    const backendMatches = BACKEND_SIGNALS.filter(sig =>
      allDeps.some(dep => dep.includes(sig.toLowerCase()))
    );

    if (backendMatches.length > 0) {
      return {
        type: PROJECT_TYPES.NODE_API,
        confidence: 0.9,
        signals: backendMatches,
        reasoning: `Found backend dependencies: ${backendMatches.join(', ')}`
      };
    }

    // RULE 3: FRONTEND_FRAMEWORK - package.json contains frontend signals
    const frontendMatches = FRONTEND_SIGNALS.filter(sig =>
      allDeps.some(dep => dep.includes(sig.toLowerCase()))
    );

    const frameworkMatches = FRONTWORK_SIGNALS.filter(sig =>
      allDeps.some(dep => dep.includes(sig.toLowerCase()))
    );

    if (frontendMatches.length > 0 || frameworkMatches.length > 0) {
      const allMatches = [...frontendMatches, ...frameworkMatches];
      return {
        type: PROJECT_TYPES.FRONTEND_FRAMEWORK,
        confidence: 0.9,
        signals: allMatches,
        reasoning: `Found frontend framework: ${allMatches.join(', ')}`
      };
    }

    // Check for package.json with scripts
    if (packageInfo.scripts && Object.keys(packageInfo.scripts).length > 0) {
      const scripts = Object.keys(packageInfo.scripts).join(' ').toLowerCase();
      if (scripts.includes('dev') || scripts.includes('start') || scripts.includes('build')) {
        return {
          type: PROJECT_TYPES.FRONTEND_FRAMEWORK,
          confidence: 0.6,
          signals: ['has npm scripts'],
          reasoning: 'Has package.json with build scripts'
        };
      }
    }
  }

  // RULE 4: Check subdirectories for nested projects (limit depth)
  const pkgPaths = await findPackageJsons(workDir, 2);
  for (const pkgPath of pkgPaths.slice(0, 5)) { // Max 5 subdirs
    if (pkgPath === 'package.json') continue; // Skip root

    const subDir = path.dirname(path.join(workDir, pkgPath));
    const subPkg = await readJsonFile(path.join(workDir, pkgPath));
    if (!subPkg) continue;

    const deps = { ...(subPkg.dependencies || {}), ...(subPkg.devDependencies || {}) };
    const allDeps = Object.keys(deps).map(d => d.toLowerCase());

    const hasBackend = BACKEND_SIGNALS.some(sig => allDeps.some(d => d.includes(sig)));
    const hasFrontend = FRONTEND_SIGNALS.some(sig => allDeps.some(d => d.includes(sig)));

    if (hasBackend) {
      return {
        type: PROJECT_TYPES.NODE_API,
        confidence: 0.7,
        signals: [`backend in ${path.dirname(pkgPath)}`],
        reasoning: `Found backend in subdirectory: ${pkgPath}`
      };
    }

    if (hasFrontend) {
      return {
        type: PROJECT_TYPES.FRONTEND_FRAMEWORK,
        confidence: 0.7,
        signals: [`frontend in ${path.dirname(pkgPath)}`],
        reasoning: `Found frontend in subdirectory: ${pkgPath}`
      };
    }
  }

  // RULE 5: Fallback
  if (hasIndexJs && !hasPackageJson) {
    return {
      type: PROJECT_TYPES.STATIC,
      confidence: 0.5,
      signals: ['index.js found'],
      reasoning: 'Single JS file, treated as static'
    };
  }

  // UNKNOWN - default to NODE_API for DevOps panel
  return {
    type: PROJECT_TYPES.NODE_API,
    confidence: 0.3,
    signals: [],
    reasoning: 'Defaulting to Node.js API'
  };
};

// Wrap with timeout
const withTimeout = (promise, ms, fallback) => {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
};

exports.analyzeProject = async (workDir) => {
  const analysisPromise = (async () => {
    const projectType = await this.detectProjectType(workDir);
    const scan = await this.scanProject(workDir);
    return { projectType, structure: scan };
  })();

  // 15 second timeout
  const result = await withTimeout(analysisPromise, 15000, {
    projectType: {
      type: PROJECT_TYPES.NODE_API,
      confidence: 0.5,
      signals: ['analysis timed out'],
      reasoning: 'Analysis timed out, defaulting to NODE_API'
    },
    structure: { files: [], directories: [], totalFiles: 0 }
  });

  return {
    ...result,
    analysisTimestamp: new Date().toISOString()
  };
};

exports.PROJECT_TYPES = PROJECT_TYPES;