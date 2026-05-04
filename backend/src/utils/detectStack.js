const fs = require('fs').promises;
const path = require('path');

const hasPackageJson = async (dir) => {
  try {
    await fs.access(path.join(dir, 'package.json'));
    return true;
  } catch {
    return false;
  }
};

const isDirectory = async (dir) => {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

exports.detectStackType = async (workDir) => {
  const entries = await fs.readdir(workDir, { withFileTypes: true });
  const directories = entries.filter(e => e.isDirectory()).map(e => e.name);
  const lowerDirs = directories.map(d => d.toLowerCase());

  let hasBackend = false;
  let hasFrontend = false;

  // Helper to find package.json recursively in subdirectories
  const findPackageJson = async (dir, maxDepth = 3, currentDepth = 0) => {
    if (currentDepth > maxDepth) return null;

    const pkgPath = path.join(dir, 'package.json');
    if (await hasPackageJson(pkgPath)) {
      return dir;
    }

    const subEntries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of subEntries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subResult = await findPackageJson(path.join(dir, entry.name), maxDepth, currentDepth + 1);
        if (subResult) return subResult;
      }
    }
    return null;
  };

  // ====== BACKEND DETECTION ======
  let detectedBackendDir = null;
  let bestBackendDir = null;
  let maxScore = 0;
  const MERN_SIGNALS = ['server', 'backend', 'api', 'api-server', 'app'];

  console.log('[detectStack] directories:', directories);
  console.log('[detectStack] lowerDirs:', lowerDirs);

  const candidates = [];
  for (const dir of MERN_SIGNALS) {
    const idx = lowerDirs.indexOf(dir.toLowerCase());
    console.log('[detectStack] checking MERN_SIGNAL:', dir, 'idx:', idx);
    if (idx !== -1) {
      const fullPath = path.join(workDir, directories[idx]);
      const hasPkg = await hasPackageJson(fullPath);
      console.log('[detectStack] dir:', dir, 'fullPath:', fullPath, 'hasPkg:', hasPkg);
      if (hasPkg) {
        hasBackend = true;
        let score = 0;
        try {
          const dirEntries = await fs.readdir(fullPath);
          console.log('[detectStack] entries in', directories[idx], ':', dirEntries);
          if (dirEntries.includes('src')) score += 10;
          if (dirEntries.includes('index.js') || dirEntries.includes('server.js') || dirEntries.includes('app.js')) score += 5;
          score += dirEntries.length;
          candidates.push({ dir: directories[idx], score });
          console.log('[detectStack] candidate:', directories[idx], 'score:', score);
          if (score > maxScore) {
            maxScore = score;
            bestBackendDir = directories[idx];
          }
        } catch {}
      }
    }
  }

  if (bestBackendDir) {
    detectedBackendDir = bestBackendDir;
    console.log('[detectStack] Selected backendDir:', bestBackendDir, 'with score:', maxScore);
  } else if (candidates.length > 0) {
    detectedBackendDir = candidates[0].dir;
  }

  // If no backend dir found but root has package.json
  if (!hasBackend && await hasPackageJson(workDir)) {
    hasBackend = true;
    detectedBackendDir = '.';
  }

  // If still no backend, check if any subdirectory has package.json
  if (!hasBackend) {
    const foundPath = await findPackageJson(workDir);
    if (foundPath) {
      hasBackend = true;
      detectedBackendDir = path.relative(workDir, foundPath);
    }
  }

  // ====== FRONTEND DETECTION ======
  let detectedFrontendDir = null;
  let bestFrontendDir = null;
  let maxFrontendScore = 0;
  const FRONTEND_SIGNALS = ['client', 'frontend', 'app', 'web', 'ui'];

  const frontendCandidates = [];
  for (const dir of FRONTEND_SIGNALS) {
    const idx = lowerDirs.indexOf(dir.toLowerCase());
    if (idx !== -1) {
      const fullPath = path.join(workDir, directories[idx]);
      if (await hasPackageJson(fullPath)) {
        hasFrontend = true;
        let score = 0;
        try {
          const dirEntries = await fs.readdir(fullPath);
          if (dirEntries.includes('src')) score += 10;
          if (dirEntries.includes('index.html') || dirEntries.includes('vite.config')) score += 5;
          score += dirEntries.length;
          frontendCandidates.push({ dir: directories[idx], score });
          if (score > maxFrontendScore) {
            maxFrontendScore = score;
            bestFrontendDir = directories[idx];
          }
        } catch {}
      }
    }
  }

  if (bestFrontendDir) {
    detectedFrontendDir = bestFrontendDir;
    console.log('[detectStack] Selected frontendDir:', bestFrontendDir, 'with score:', maxFrontendScore);
  } else if (frontendCandidates.length > 0) {
    detectedFrontendDir = frontendCandidates[0].dir;
  }

  // Check if root directory has a React/Vite app
  if (!hasFrontend && await hasPackageJson(workDir)) {
    try {
      const pkgContent = await fs.readFile(path.join(workDir, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgContent);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react || deps.vue || deps['@vitejs/plugin-react']) {
        hasFrontend = true;
        detectedFrontendDir = '.';
      }
    } catch {}
  }

  // If still not found, scan all directories for React/Vite indicators
  if (!hasFrontend) {
    for (const dir of directories) {
      if (dir.startsWith('.')) continue;
      const fullPath = path.join(workDir, dir);
      try {
        const pkgPath = path.join(fullPath, 'package.json');
        if (await hasPackageJson(pkgPath)) {
          const pkgContent = await fs.readFile(pkgPath, 'utf8');
          const pkg = JSON.parse(pkgContent);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.react || deps.vue || deps['@vitejs/plugin-react'] || pkg.devDependencies?.vite) {
            hasFrontend = true;
            detectedFrontendDir = dir;
            break;
          }
        }
      } catch {}
    }
  }

  console.log('[detectStack] Final - backend:', detectedBackendDir, 'frontend:', detectedFrontendDir, 'hasFrontend:', hasFrontend);

  if (hasBackend) {
    return {
      type: 'mern',
      hasBackend: true,
      hasFrontend: hasFrontend,
      frontendDir: detectedFrontendDir,
      backendDir: detectedBackendDir || 'server',
      directories
    };
  }

  return {
    type: 'single',
    hasBackend: false,
    hasFrontend: false,
    frontendDir: null,
    backendDir: null,
    directories
  };
};

exports.getProjectStructure = async (workDir) => {
  const structure = {
    root: {},
    directories: []
  };

  try {
    const rootPkg = path.join(workDir, 'package.json');
    if (await hasPackageJson(rootPkg)) {
      structure.root = JSON.parse(await fs.readFile(rootPkg, 'utf8'));
    }
  } catch {}

  const entries = await fs.readdir(workDir, { withFileTypes: true });
  structure.directories = entries.filter(e => e.isDirectory()).map(e => e.name);

  return structure;
};