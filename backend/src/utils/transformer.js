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

    // Route ALL traffic to the serverless function
    baseConfig.rewrites = [
      { source: '/(.*)', destination: '/api/index.js' }
    ];

    // Headers for CORS
    baseConfig.headers = [
      {
        source: '/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' }
        ]
      }
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

  // Transform Express app for Vercel serverless
  // Vercel expects: module.exports = (req, res) => { ... }
  // For Express: wrap the app in a serverless handler
  if (content.includes('app.listen')) {
    // Get all JS files in the same directory as server file for copying
    const serverDir = path.dirname(serverFile.path);

    // Create a Vercel serverless handler
    const handler = `// Vercel Serverless Function
const { createServer } = require('http');
const path = require('path');

// Load Express app - look for app.js in the same directory
let app;
try {
  app = require('./app');
} catch (e) {
  // If no app.js, create minimal Express
  const express = require('express');
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Add health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Root handler
  app.get('/', (req, res) => {
    res.json({ message: 'API running', endpoints: ['/api/health'] });
  });
}

// Vercel serverless handler
module.exports = (req, res) => {
  const server = createServer(app);
  server.emit('request', req, res);
};
`;
    content = handler;
    result.transformed = true;
  }

  if (content.includes('http.createServer')) {
    content = `
module.exports = (req, res) => {
  // Vercel serverless handler
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
};
`;
    result.transformed = true;
  }

  // If no known pattern, wrap in serverless handler
  if (!content.includes('module.exports') && !content.includes('export default')) {
    content = `
const app = require('./app');

module.exports = (req, res) => {
  const server = createServer(app);
  server.emit('request', req, res);
};
`;
    result.transformed = true;
  }

  // Write to api/index.js
  await fs.writeFile(apiIndexPath, content);
  result.files.push(apiIndexPath);

  // Copy app.js to api folder if it exists at root (for the handler to import)
  const appPath = path.join(workDir, 'app.js');
  if (fs.existsSync(appPath) && serverFile.path !== appPath) {
    const apiAppPath = path.join(apiDir, 'app.js');
    await fs.copyFile(appPath, apiAppPath);
    result.files.push(apiAppPath);
  }

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

  // For Node API, ensure the serverless function entry is clear
  if (projectType === PROJECT_TYPES.NODE_API) {
    vercelConfig.functions = {
      'api/index.js': {
        'runtime': 'nodejs18.x',
        'memory': 1024,
        'maxDuration': 10
      }
    };
  }

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
    // Keep CommonJS for serverless - Vercel handles ESM internally
    // pkg.type = 'module';
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

  // Helper to flatten nested project structures (backend/, src/, etc.) to root
  const flattenStructure = async () => {
    const entries = await fs.readdir(workDir, { withFileTypes: true });
    const dirsToFlatten = entries.filter(e => e.isDirectory() &&
      ['backend', 'src', 'server', 'app'].includes(e.name.toLowerCase()));

    for (const dir of dirsToFlatten) {
      const subDir = path.join(workDir, dir.name);
      try {
        const subEntries = await fs.readdir(subDir, { withFileTypes: true });
        for (const entry of subEntries) {
          const srcPath = path.join(subDir, entry.name);
          const destPath = path.join(workDir, entry.name);
          if (!fs.existsSync(destPath)) {
            if (entry.isDirectory()) {
              await fs.mkdir(destPath, { recursive: true });
              const subFiles = await fs.readdir(srcPath, { withFileTypes: true });
              for (const file of subFiles) {
                await fs.copyFile(path.join(srcPath, file.name), path.join(destPath, file.name));
              }
            } else {
              await fs.copyFile(srcPath, destPath);
            }
          }
        }
        // Remove the flattened subdirectory
        fs.rmSync(subDir, { recursive: true, force: true });
      } catch {}
    }
  };

  // Flatten nested structures like backend/, src/ to root level
  await flattenStructure();

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