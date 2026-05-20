const fs = require('fs').promises;
const path = require('path');

/**
 * AI Architect Module
 * The "Master Planner" that reads messy repos and decides on clean structure
 */

// ===== STEP 1: REPOSITORY DISCOVERY (Eyes of the AI) =====
// Generates a complete file map of the repository
async function getRepoStructure(workDir) {
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.cache', '__pycache__'];

  const scanDir = async (dir, depth = 0) => {
    if (depth > 5) return [];

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      if (excludeDirs.includes(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(workDir, fullPath);

      if (entry.isDirectory()) {
        results.push(`${relativePath}/`);
        const subResults = await scanDir(fullPath, depth + 1);
        results.push(...subResults);
      } else {
        results.push(relativePath);
      }
    }

    return results;
  };

  const allFiles = await scanDir(workDir);
  // Sanitize: Convert Windows backslashes to forward slashes for API compatibility
  return allFiles.join('\n').replace(/\\/g, '/');
}

// ===== STEP 2: PACKAGE ANALYSIS =====
// Reads all package.json files and extracts dependency info
async function analyzePackages(workDir) {
  const packages = [];

  const scanForPackages = async (dir, depth = 0) => {
    if (depth > 4) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.name === 'package.json') {
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const pkg = JSON.parse(content);
            packages.push({
              path: path.relative(workDir, dir),
              name: pkg.name || path.basename(dir),
              scripts: Object.keys(pkg.scripts || {}),
              deps: Object.keys(pkg.dependencies || {}),
              devDeps: Object.keys(pkg.devDependencies || {})
            });
          } catch {}
        } else if (entry.isDirectory()) {
          await scanForPackages(fullPath, depth + 1);
        }
      }
    } catch {}
  };

  await scanForPackages(workDir);
  return packages;
}

// ===== STEP 3: CONFIG FILE ANALYSIS =====
// Reads key config files for understanding the tech stack
async function analyzeConfigs(workDir) {
  const configs = {};

  const configFiles = {
    'vite.config.js': 'Vite',
    'vite.config.ts': 'Vite',
    'webpack.config.js': 'Webpack',
    'next.config.js': 'Next.js',
    'nuxt.config.js': 'Nuxt',
    'tsconfig.json': 'TypeScript',
    'jsconfig.json': 'JavaScript',
    '.env.example': 'Env Vars',
    '.env': 'Env Vars'
  };

  for (const [filename, label] of Object.entries(configFiles)) {
    try {
      const filePath = path.join(workDir, filename);
      await fs.access(filePath);
      configs[label] = filename;
    } catch {}
  }

  // Check for frontend/backend subdirectories
  try {
    const entries = await fs.readdir(workDir);
    const subdirs = entries.filter(e => {
      try {
        return (fs.statSync(path.join(workDir, e))).isDirectory();
      } catch {
        return false;
      }
    });

    configs.subdirectories = subdirs.filter(d =>
      !['node_modules', '.git', 'dist', 'build'].includes(d)
    );
  } catch {}

  return configs;
}

// ===== STEP 4: SOURCE FILE ANALYSIS =====
// Reads key source files to understand the codebase
async function analyzeSource(workDir) {
  const sourceInfo = {
    frontend: null,
    backend: null,
    apiFiles: []
  };

  // Find frontend entry points
  const frontendCandidates = [
    'frontend/src/main.jsx',
    'frontend/src/main.js',
    'frontend/index.html',
    'client/src/index.jsx',
    'client/src/index.js',
    'src/main.jsx',
    'src/main.js'
  ];

  for (const candidate of frontendCandidates) {
    const filePath = path.join(workDir, candidate);
    try {
      await fs.access(filePath);
      sourceInfo.frontend = candidate;
      break;
    } catch {}
  }

  // Find backend entry points
  const backendCandidates = [
    'backend/server.js',
    'backend/src/index.js',
    'backend/src/app.js',
    'server.js',
    'src/server.js',
    'src/app.js'
  ];

  for (const candidate of backendCandidates) {
    const filePath = path.join(workDir, candidate);
    try {
      await fs.access(filePath);
      sourceInfo.backend = candidate;
      break;
    } catch {}
  }

  // Find API/server files
  try {
    const apiPath = path.join(workDir, 'api');
    if ((await fs.stat(apiPath)).isDirectory()) {
      const apiFiles = await fs.readdir(apiPath);
      sourceInfo.apiFiles = apiFiles;
    }
  } catch {}

  return sourceInfo;
}

// ===== MASTER ARCHITECT FUNCTION =====
// Combines all analysis into a complete repo audit
async function architectAudit(workDir) {
  console.log('[Architect] Starting AI Master Audit...');

  const audit = {
    timestamp: new Date().toISOString(),
    structure: '',
    packages: [],
    configs: {},
    source: {},
    recommendations: []
  };

  // 1. Get full repo structure
  console.log('[Architect] Mapping repository structure...');
  audit.structure = await getRepoStructure(workDir);

  // 2. Analyze packages
  console.log('[Architect] Analyzing package.json files...');
  audit.packages = await analyzePackages(workDir);

  // 3. Analyze configs
  console.log('[Architect] Reading configuration files...');
  audit.configs = await analyzeConfigs(workDir);

  // 4. Analyze source
  console.log('[Architect] Locating source entry points...');
  audit.source = await analyzeSource(workDir);

  // 5. Generate recommendations
  console.log('[Architect] Generating recommendations...');

  const isMERN = audit.packages.some(p =>
    p.deps.includes('express') && p.deps.some(d => ['react', 'vue', 'angular'].includes(d))
  );

  const hasVite = audit.packages.some(p => p.deps.includes('vite') || p.devDeps.includes('vite'));
  const hasNext = audit.packages.some(p => p.deps.includes('next'));

  if (isMERN) {
    audit.recommendations.push('MERN stack detected - requires api/ folder for serverless functions');
  }

  if (hasVite) {
    audit.recommendations.push('Vite project - ensure outputDirectory is set correctly');
    audit.recommendations.push('Check vite.config.js for base path - must be "/" for Vercel');
  }

  if (hasNext) {
    audit.recommendations.push('Next.js project - use @vercel/next builder');
  }

  const hasSubdirs = audit.configs.subdirectories?.length > 0;
  if (hasSubdirs) {
    audit.recommendations.push(`Project has subdirectories: ${audit.configs.subdirectories.join(', ')}`);
    audit.recommendations.push('Build command must cd into the correct folder');
  }

  console.log('[Architect] === MASTER AUDIT COMPLETE ===');
  console.log(`  Structure: ${audit.structure.split('\n').length} files`);
  console.log(`  Packages: ${audit.packages.length}`);
  console.log(`  MERN: ${isMERN}`);
  console.log(`  Vite: ${hasVite}`);
  console.log(`  Recommendations: ${audit.recommendations.length}`);

  return audit;
}

module.exports = {
  getRepoStructure,
  analyzePackages,
  analyzeConfigs,
  analyzeSource,
  architectAudit
};