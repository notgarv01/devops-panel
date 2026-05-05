const fs = require('fs').promises;
const path = require('path');

const PROJECT_TYPES = require('./analyzer').PROJECT_TYPES;

// Patterns that indicate MERN stack
const MERN_PATTERNS = {
  backend: ['express', 'mongoose', 'koa', 'fastify', 'hapi'],
  frontend: ['react', 'vue', 'next', 'angular', 'svelte'],
  fullstack: ['concurrently', 'rootPkgHasBoth']
};

const generateVercelConfig = (projectType, config = {}) => {
  const baseConfig = {
    version: 2,
    builds: []
  };

  if (projectType === PROJECT_TYPES.STATIC) {
    baseConfig.builds.push({
      src: 'index.html',
      use: '@vercel/static'
    });
    return baseConfig;
  }

  if (projectType === PROJECT_TYPES.FRONTEND_FRAMEWORK) {
    baseConfig.builds.push({
      src: 'package.json',
      use: '@vercel/static-build',
      config: { distDir: 'dist' }
    });

    baseConfig.rewrites = [
      { source: '/(.*)', destination: '/index.html' }
    ];
    return baseConfig;
  }

  if (projectType === PROJECT_TYPES.NODE_API) {
    baseConfig.builds.push({
      src: 'api/**/*.js',
      use: '@vercel/node'
    });

    // For API-only projects, all routes go to the serverless function
    baseConfig.rewrites = [
      { source: '/(.*)', destination: '/api/index.js' }
    ];

    return baseConfig;
  }

  return baseConfig;
};

const findServerFile = async (dir) => {
  const candidates = ['server.js', 'app.js', 'index.js', 'main.js', 'src/index.js', 'src/server.js'];
  const scanned = new Set();

  const scan = async (currentDir, depth = 0) => {
    if (depth > 3 || scanned.size > 50) return null;
    scanned.add(currentDir);

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const candidate of candidates) {
        const filePath = path.join(currentDir, candidate);
        if (scanned.has(filePath)) continue;

        try {
          await fs.access(filePath);
          const content = await fs.readFile(filePath, 'utf8');

          if (content.includes('express') ||
              content.includes('http.createServer') ||
              content.includes('app.listen') ||
              content.includes('module.exports')) {
            return { path: filePath, name: candidate };
          }
        } catch {}
      }

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const result = await scan(path.join(currentDir, entry.name), depth + 1);
          if (result) return result;
        }
      }
    } catch {}

    return null;
  };

  return scan(dir);
};

const ensureApiFolder = async (workDir) => {
  const apiDir = path.join(workDir, 'api');
  await fs.mkdir(apiDir, { recursive: true });
  return apiDir;
};

const checkApiPattern = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const hasListen = /app\.listen\s*\(/.test(content);
    const hasModuleExports = /module\.exports\s*=/.test(content);
    return { hasListen, hasModuleExports, content };
  } catch {
    return { hasListen: false, hasModuleExports: false, content: null };
  }
};

const transformServerFile = async (workDir, serverFile) => {
  const result = {
    moved: false,
    transformed: false,
    files: []
  };

  const apiDir = await ensureApiFolder(workDir);
  const apiIndexPath = path.join(apiDir, 'index.js');

  let content = serverFile.content || await fs.readFile(serverFile.path, 'utf8');

  // Transform: Replace app.listen() with export default app
  if (content.includes('app.listen')) {
    content = content.replace(
      /app\.listen\s*\(\s*(\d+|\w+)\s*(,\s*(?:async\s*)?(?:\([^)]*\)\s*)?(?:=>\s*)?{[^}]*})?\s*\)/g,
      'export default app;'
    );
    result.transformed = true;
  }

  if (content.includes('http.createServer')) {
    content = content.replace(
      /http\.createServer\s*\(\s*\(?\s*req\s*,?\s*res\s*\)?\s*=>/g,
      'export default (req, res) => {'
    ).replace(
      /}\s*\)\s*\(\s*\)\s*;?\s*$/,
      '};'
    );
    result.transformed = true;
  }

  // Ensure it ends with export default
  if (!content.includes('export default')) {
    const lines = content.trim().split('\n');
    const lastNonEmpty = [...lines].reverse().find(l => l.trim().length > 0);
    if (!lastNonEmpty.includes('export default')) {
      content = content.trim() + '\nexport default app;';
      result.transformed = true;
    }
  }

  // Remove CORS issues for serverless
  if (!content.includes('cors()') && !content.includes("require('cors')") && !content.includes('"cors"')) {
    // Add CORS middleware if not present
  }

  // Write to api/index.js
  await fs.writeFile(apiIndexPath, content);
  result.files.push(apiIndexPath);

  // If original file is in a different location, optionally remove it
  if (path.dirname(serverFile.path) !== apiDir) {
    const relativePath = path.relative(workDir, serverFile.path);
    result.originalPath = relativePath;
    result.moved = true;
  }

  return result;
};

const injectVercelJson = async (workDir, projectType, config = {}) => {
  const vercelConfig = generateVercelConfig(projectType, config);
  const vercelJsonPath = path.join(workDir, 'vercel.json');

  await fs.writeFile(vercelJsonPath, JSON.stringify(vercelConfig, null, 2));

  return {
    path: vercelJsonPath,
    config: vercelConfig
  };
};

const injectNowJson = async (workDir, projectType) => {
  const nowConfig = {
    version: 2,
    ...generateVercelConfig(projectType)
  };
  const nowJsonPath = path.join(workDir, 'now.json');

  await fs.writeFile(nowJsonPath, JSON.stringify(nowConfig, null, 2));

  return {
    path: nowJsonPath,
    config: nowConfig
  };
};

const injectPackageJsonType = async (workDir) => {
  const pkgPath = path.join(workDir, 'package.json');
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    pkg.type = 'module';
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    return { path: pkgPath, updated: true };
  } catch {
    return { path: pkgPath, updated: false };
  }
};

exports.transformForDeployment = async (workDir, projectType, options = {}) => {
  const results = {
    vercelJson: null,
    serverTransformed: null,
    files: [],
    transformations: []
  };

  // Check for MERN stack (both backend and frontend directories)
  const mernResult = await detectMernStack(workDir);
  if (mernResult.isMern) {
    projectType = 'MERN';
    results.mernStructure = mernResult;
  }

  // 1. Find and potentially transform server file
  if (projectType === PROJECT_TYPES.NODE_API || projectType === 'MERN') {
    const serverFile = await findServerFile(workDir);

    if (serverFile) {
      const fileInfo = await checkApiPattern(serverFile.path);

      if (!fileInfo.hasModuleExports || fileInfo.hasListen) {
        const transformResult = await transformServerFile(workDir, {
          path: serverFile.path,
          content: fileInfo.content
        });

        results.serverTransformed = {
          found: true,
          ...transformResult
        };
        results.transformations.push({
          type: 'server_transform',
          ...transformResult
        });
      } else {
        // Server file already has module.exports, just move to api folder
        const apiDir = await ensureApiFolder(workDir);
        const apiIndexPath = path.join(apiDir, 'index.js');
        await fs.copyFile(serverFile.path, apiIndexPath);

        results.serverTransformed = {
          found: true,
          moved: true,
          files: [apiIndexPath]
        };
        results.transformations.push({
          type: 'server_move',
          from: serverFile.path,
          to: apiIndexPath
        });
      }
    }
  }

  // 2. Inject vercel.json
  const vercelResult = await injectVercelJson(workDir, projectType, options);
  results.vercelJson = vercelResult;
  results.files.push(vercelResult.path);
  results.transformations.push({
    type: 'vercel_json',
    path: vercelResult.path
  });

  // 3. Add "type": "module" to package.json for ESM support
  const pkgResult = await injectPackageJsonType(workDir);
  if (pkgResult.updated) {
    results.files.push(pkgResult.path);
    results.transformations.push({
      type: 'package_json_esm',
      path: pkgResult.path
    });
  }

  // 4. Optionally inject now.json for backward compatibility
  if (options.includeNowJson) {
    const nowResult = await injectNowJson(workDir, projectType);
    results.nowJson = nowResult;
    results.files.push(nowResult.path);
    results.transformations.push({
      type: 'now_json',
      path: nowResult.path
    });
  }

  console.log(`[Transform] Completed ${results.transformations.length} transformations`);

  return results;
};

// MERN Stack Detection & Transformation
const detectMernStack = async (workDir) => {
  const entries = await fs.readdir(workDir, { withFileTypes: true });
  const directories = entries.filter(e => e.isDirectory()).map(e => e.name.toLowerCase());

  const hasServer = directories.some(d => ['server', 'backend', 'api', 'app'].includes(d));
  const hasClient = directories.some(d => ['client', 'frontend', 'app', 'web', 'ui'].includes(d));

  // Check root package.json for "concurrently" or both backend+frontend deps
  let rootPkg = null;
  try {
    const rootPkgContent = await fs.readFile(path.join(workDir, 'package.json'), 'utf8');
    rootPkg = JSON.parse(rootPkgContent);
  } catch {}

  const deps = rootPkg ? { ...rootPkg.dependencies, ...rootPkg.devDependencies } : {};
  const hasConcurrently = deps.concurrently;
  const hasExpress = deps.express;
  const hasReact = deps.react;

  return {
    isMern: (hasServer && hasClient) || hasConcurrently || (hasExpress && hasReact),
    hasServer,
    hasClient,
    hasConcurrently,
    serverDir: directories.find(d => ['server', 'backend', 'api'].includes(d)),
    clientDir: directories.find(d => ['client', 'frontend', 'app', 'web', 'ui'].includes(d))
  };
};

const transformMernProject = async (workDir, mernInfo) => {
  const results = {
    serverConfig: null,
    clientConfig: null,
    vercelJson: null,
    files: []
  };

  // Transform server (move to /api if needed)
  if (mernInfo.serverDir) {
    const serverPath = path.join(workDir, mernInfo.serverDir);
    const serverFile = await findServerFile(serverPath);

    if (serverFile) {
      // Ensure server ends with module.exports
      const content = await fs.readFile(serverFile.path, 'utf8');
      if (content.includes('app.listen')) {
        const transformed = content.replace(/app\.listen\s*\(\s*(\d+|\w+)/g, '// Vercel serverless\nmodule.exports = app; // Removed: app.listen($1');
        await fs.writeFile(serverFile.path, transformed);
        results.serverConfig = { transformed: true, path: serverFile.path };
      }
    }
  }

  // Generate vercel.json for MERN
  const vercelConfig = {
    version: 2,
    builds: [
      {
        src: 'api/**/*.js',
        use: '@vercel/node'
      },
      {
        src: 'package.json',
        use: '@vercel/static-build',
        config: { distDir: 'dist' }
      }
    ],
    rewrites: [
      { source: '/api/(.*)', destination: '/api/index.js' },
      { source: '/(.*)', destination: '/index.html' }
    ]
  };

  const vercelJsonPath = path.join(workDir, 'vercel.json');
  await fs.writeFile(vercelJsonPath, JSON.stringify(vercelConfig, null, 2));
  results.vercelJson = vercelConfig;
  results.files.push(vercelJsonPath);

  return results;
};

exports.generateVercelConfig = generateVercelConfig;
exports.findServerFile = findServerFile;
exports.transformServerFile = transformServerFile;
exports.ensureApiFolder = ensureApiFolder;