const fs = require('fs');
const fsp = require('fs').promises;
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

    // Add API proxy rewrite for frontend to call backend
    baseConfig.rewrites = [
      { "source": "/api/(.*)", "destination": "/api/index.js" },
      { "source": "/(.*)", "destination": "/index.html" }
    ];
    return baseConfig;
  }

  if (projectType === PROJECT_TYPES.NODE_API || projectType === 'NODE_API' || projectType === 'MERN') {
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

    // For MERN, also add frontend build
    if (projectType === 'MERN') {
      baseConfig.builds.push({
        src: 'package.json',
        use: '@vercel/static-build',
        config: { distDir: 'dist' }
      });
    }

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
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });

      for (const candidate of candidates) {
        const filePath = path.join(currentDir, candidate);
        if (scanned.has(filePath)) continue;

        try {
          await fsp.access(filePath);
          const content = await fsp.readFile(filePath, 'utf8');

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
  await fsp.mkdir(apiDir, { recursive: true });
  return apiDir;
};

const checkApiPattern = async (filePath) => {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
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

  let content = serverFile.content || await fsp.readFile(serverFile.path, 'utf8');

  // Transform Express app for Vercel serverless
  // Vercel expects: module.exports = (req, res) => { ... }
  // For Express: wrap the app in a serverless handler
  if (content.includes('app.listen')) {
    // Create a Vercel serverless handler
    const handler = `// Vercel Serverless Function
const { createServer } = require('http');

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
  await fsp.writeFile(apiIndexPath, content);
  result.files.push(apiIndexPath);

  // Copy app.js to api folder if it exists at root (for the handler to import)
  const appPath = path.join(workDir, 'app.js');
  if (fs.existsSync(appPath) && serverFile.path !== appPath) {
    const apiAppPath = path.join(apiDir, 'app.js');
    await fsp.copyFile(appPath, apiAppPath);
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

// injectVercelJson removed - vercel.json is now generated inline in transformForDeployment

const injectNowJson = async (workDir, projectType) => {
  const nowConfig = {
    version: 2,
    ...generateVercelConfig(projectType)
  };
  const nowJsonPath = path.join(workDir, 'now.json');

  await fsp.writeFile(nowJsonPath, JSON.stringify(nowConfig, null, 2));

  return {
    path: nowJsonPath,
    config: nowConfig
  };
};

const injectPackageJsonType = async (workDir) => {
  const pkgPath = path.join(workDir, 'package.json');
  try {
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
    // Remove "type": "module" to keep CommonJS for serverless
    // Vercel serverless functions work better with CommonJS
    if (pkg.type === 'module') {
      delete pkg.type;
      await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      console.log('[Transform] Removed "type": "module" from package.json');
      return { path: pkgPath, updated: true };
    }
    return { path: pkgPath, updated: false };
  } catch {
    return { path: pkgPath, updated: false };
  }
};

exports.transformForDeployment = async (workDir, projectType, options = {}) => {
  console.log('===========================================');
  console.log('[Transform] FUNCTION STARTED');
  console.log(`[Transform] workDir: ${workDir}`);
  console.log(`[Transform] projectType: "${projectType}"`);
  console.log(`[Transform] typeof projectType: ${typeof projectType}`);
  console.log(`[Transform] PROJECT_TYPES:`, PROJECT_TYPES);
  console.log(`[Transform] PROJECT_TYPES.NODE_API: "${PROJECT_TYPES.NODE_API}"`);
  console.log(`[Transform] projectType === PROJECT_TYPES.NODE_API: ${projectType === PROJECT_TYPES.NODE_API}`);
  console.log('===========================================');

  const results = {
    vercelJson: null,
    serverTransformed: null,
    files: [],
    transformations: []
  };

  // Check for MERN stack (both backend and frontend directories)
  // Store the original project type before any modifications
  const originalProjectType = projectType;

  const mernResult = await detectMernStack(workDir);
  if (mernResult.isMern) {
    results.mernStructure = mernResult;
    console.log(`[Transform] MERN stack detected! Has frontend: ${mernResult.hasClient}, Has backend: ${mernResult.hasServer}`);

    // Check if frontend folder has actual content (package.json, src, etc.)
    const frontendPath = path.join(workDir, mernResult.clientDir || 'frontend');
    const frontendPkgPath = path.join(frontendPath, 'package.json');

    if (fs.existsSync(frontendPkgPath)) {
      projectType = 'MERN';
      console.log(`[Transform] Switching to MERN config for full-stack deployment`);
    } else {
      console.log(`[Transform] Frontend folder empty, keeping as NODE_API`);
      projectType = originalProjectType;
    }
  }

  // Helper to flatten nested project structures (backend/, src/, etc.) to root
  const flattenStructure = async () => {
    const entries = await fsp.readdir(workDir, { withFileTypes: true });
    const dirsToFlatten = entries.filter(e => e.isDirectory() &&
      ['backend', 'src', 'server', 'app'].includes(e.name.toLowerCase()));

    for (const dir of dirsToFlatten) {
      const subDir = path.join(workDir, dir.name);
      try {
        const subEntries = await fsp.readdir(subDir, { withFileTypes: true });
        for (const entry of subEntries) {
          const srcPath = path.join(subDir, entry.name);
          const destPath = path.join(workDir, entry.name);
          if (!fs.existsSync(destPath)) {
            if (entry.isDirectory()) {
              await fsp.mkdir(destPath, { recursive: true });
              const subFiles = await fsp.readdir(srcPath, { withFileTypes: true });
              for (const file of subFiles) {
                await fsp.copyFile(path.join(srcPath, file.name), path.join(destPath, file.name));
              }
            } else {
              await fsp.copyFile(srcPath, destPath);
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
  let serverFileFound = false;
  if (projectType === PROJECT_TYPES.NODE_API || projectType === 'NODE_API' || projectType === 'MERN') {
    const serverFile = await findServerFile(workDir);
    console.log(`[Transform] findServerFile result:`, serverFile);

    if (serverFile) {
      serverFileFound = true;
      console.log(`[Transform] Found server file: ${serverFile.path}`);
      const fileInfo = await checkApiPattern(serverFile.path);
      console.log(`[Transform] API pattern check: hasModuleExports=${fileInfo.hasModuleExports}, hasListen=${fileInfo.hasListen}`);

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
        await fsp.copyFile(serverFile.path, apiIndexPath);

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

  // 2. Inject vercel.json - call AFTER server transformation so we know the correct project type
  console.log('----------- VERCEL.JSON GENERATION -----------');
  console.log(`[Transform] projectType at vercel.json: "${projectType}"`);
  console.log(`[Transform] projectType === 'NODE_API': ${projectType === 'NODE_API'}`);
  console.log(`[Transform] projectType === PROJECT_TYPES.NODE_API: ${projectType === PROJECT_TYPES.NODE_API}`);

  // Always start fresh with proper config for NODE_API
  let vercelConfig;
  if (projectType === PROJECT_TYPES.NODE_API || projectType === 'NODE_API') {
    vercelConfig = {
      version: 2,
      builds: [{
        src: 'api/**/*.js',
        use: '@vercel/node'
      }],
      rewrites: [
        { "source": "/(.*)", "destination": "/api/index.js" }
      ],
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'Access-Control-Allow-Origin', value: '*' },
            { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
            { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' }
          ]
        }
      ]
    };
    console.log(`[Transform] Created fresh vercelConfig for NODE_API:`, JSON.stringify(vercelConfig, null, 2));
  } else if (projectType === 'MERN') {
    // MERN stack - clean SPA config WITHOUT builds array
    // Using modern config style only
    vercelConfig = {
      version: 2,
      buildCommand: 'cd frontend && npm install && npm run build',
      outputDirectory: 'frontend/dist',
      rewrites: [
        { "source": "/api/(.*)", "destination": "/api/index.js" },
        { "source": "/(.*)", "destination": "/index.html" }
      ]
    };
    console.log(`[Transform] Created fresh vercelConfig for MERN:`, JSON.stringify(vercelConfig, null, 2));
  } else {
    vercelConfig = generateVercelConfig(projectType, options);
  }

  const vercelJsonPath = path.join(workDir, 'vercel.json');
  await fsp.writeFile(vercelJsonPath, JSON.stringify(vercelConfig, null, 2));

  // Immediately read it back to verify
  const verification = await fsp.readFile(vercelJsonPath, 'utf8');
  console.log(`[Transform] vercel.json verification (first 200 chars):`, verification.substring(0, 200));

  results.vercelJson = { path: vercelJsonPath, config: vercelConfig };
  results.files.push(vercelJsonPath);
  results.transformations.push({
    type: 'vercel_json',
    path: vercelJsonPath
  });

  // List directory contents to see what was created
  const finalEntries = await fsp.readdir(workDir, { withFileTypes: true });
  console.log(`[Transform] Final directory contents:`);
  finalEntries.forEach(e => console.log(`  ${e.name}${e.isDirectory() ? '/' : ''}`));

  // Check if api folder exists and has files
  try {
    const apiEntries = await fsp.readdir(path.join(workDir, 'api'), { withFileTypes: true });
    console.log(`[Transform] api/ folder contents:`);
    apiEntries.forEach(e => console.log(`    ${e.name}`));
  } catch (e) {
    console.log(`[Transform] api/ folder NOT FOUND!`);
  }

  // 3. Add "type": "module" to package.json for ESM support
  const pkgResult = await injectPackageJsonType(workDir);
  if (pkgResult.updated) {
    results.files.push(pkgResult.path);
    results.transformations.push({
      type: 'package_json_esm',
      path: pkgResult.path
    });
  }

  // For MERN, add vercel-build script to root package.json
  if (projectType === 'MERN') {
    const pkgPath = path.join(workDir, 'package.json');
    try {
      const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
      pkg.scripts = pkg.scripts || {};
      pkg.scripts['vercel-build'] = 'cd frontend && npm install && npm run build';
      await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      console.log('[Transform] Added vercel-build script to package.json');
    } catch {}
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
  const entries = await fsp.readdir(workDir, { withFileTypes: true });
  const directories = entries.filter(e => e.isDirectory()).map(e => e.name.toLowerCase());

  const hasServer = directories.some(d => ['server', 'backend', 'api', 'app'].includes(d));
  const hasClient = directories.some(d => ['client', 'frontend', 'app', 'web', 'ui'].includes(d));

  // Check root package.json for "concurrently" or both backend+frontend deps
  let rootPkg = null;
  try {
    const rootPkgContent = await fsp.readFile(path.join(workDir, 'package.json'), 'utf8');
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
      const content = await fsp.readFile(serverFile.path, 'utf8');
      if (content.includes('app.listen')) {
        const transformed = content.replace(/app\.listen\s*\(\s*(\d+|\w+)/g, '// Vercel serverless\nmodule.exports = app; // Removed: app.listen($1');
        await fsp.writeFile(serverFile.path, transformed);
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
  await fsp.writeFile(vercelJsonPath, JSON.stringify(vercelConfig, null, 2));
  results.vercelJson = vercelConfig;
  results.files.push(vercelJsonPath);

  return results;
};

exports.generateVercelConfig = generateVercelConfig;
exports.findServerFile = findServerFile;
exports.transformServerFile = transformServerFile;
exports.ensureApiFolder = ensureApiFolder;