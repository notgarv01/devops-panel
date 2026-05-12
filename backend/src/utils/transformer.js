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

    // Add API proxy rewrite for frontend to call backend in same deployment
    baseConfig.rewrites = [
      { source: '/api/:path*', destination: '/api/:path*' },
      { source: '/(.*)', destination: '/index.html' }
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

  const isServerFile = async (filePath) => {
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      return content.includes('express') ||
             content.includes('http.createServer') ||
             content.includes('app.listen') ||
             content.includes('app = express') ||
             content.includes('module.exports');
    } catch {
      return false;
    }
  };

  const scan = async (currentDir, depth = 0) => {
    if (depth > 5 || scanned.size > 100) return null;
    scanned.add(currentDir);

    try {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });

      // First check named candidates in current directory
      for (const candidate of candidates) {
        const filePath = path.join(currentDir, candidate);
        if (!scanned.has(filePath)) {
          try {
            await fsp.access(filePath);
            if (await isServerFile(filePath)) {
              return { path: filePath, name: candidate };
            }
          } catch {}
        }
      }

      // Then scan all subdirectories and files recursively
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (scanned.has(fullPath)) continue;

        if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs') || entry.name.endsWith('.mjs'))) {
          try {
            if (await isServerFile(fullPath)) {
              return { path: fullPath, name: entry.name };
            }
          } catch {}
        } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const result = await scan(fullPath, depth + 1);
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
  // Vercel expects: module.exports = async (req, res) => { ... }
  // For Express: need async wrapper with error handling

  // Check if server exports properly or uses app.listen
  const hasAppListen = /app\.listen\s*\(/.test(content);
  const hasModuleExports = /module\.exports/.test(content);
  const hasMongoose = /mongoose/.test(content);

  if (hasAppListen || !hasModuleExports) {
    // Remove app.listen and add proper Vercel serverless export
    content = content.replace(/app\.listen\s*\(.*\);?/g, '');
    content = content.replace(/server\.listen\s*\(.*\);?/g, '');

    // Generate standalone api/index.js that requires app from original location
    // The server.js is the entry point, so we require it directly
    const isStandaloneServer = content.includes('const app = express()') ||
                               content.includes('const app = require');

    // Build standalone handler
    let standaloneHandler;

    if (isStandaloneServer) {
      // Server file has app defined inline - execute it and get the app
      standaloneHandler = `
const serverContent = require('./server.js');
const app = typeof serverContent === 'function' ? serverContent :
            (serverContent && serverContent.app) ? serverContent.app :
            serverContent;

module.exports = async (req, res) => {
  if (!app || typeof app !== 'function') {
    return res.status(500).json({ success: false, error: 'App not found' });
  }
  return app(req, res);
};`;
    } else {
      // Try to require from the server file
      standaloneHandler = `
let app;
try {
  // Try to get app from server.js export
  const serverModule = require('./server.js');
  app = serverModule.app || serverModule;
} catch (e) {
  console.error('[API] Failed to require server:', e.message);
}

module.exports = async (req, res) => {
  if (!app) {
    return res.status(500).json({ success: false, error: 'App not initialized' });
  }
  try {
    return app(req, res);
  } catch (error) {
    console.error('[API] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};`;
    }

    // Write standalone handler instead of transforming inline
    await fsp.writeFile(apiIndexPath, standaloneHandler);
    result.transformed = true;
    result.files.push(apiIndexPath);
    console.log('[Transform] Wrote standalone serverless handler to api/index.js');

    return result;
  } else {
    // Already has module.exports - handle it
    const existingExport = content.match(/module\.exports\s*=\s*(.+)/)?.[1];
    if (existingExport) {
      // Write the original content as-is since it already exports properly
      await fsp.writeFile(apiIndexPath, content);
      result.transformed = false;
      result.files.push(apiIndexPath);
      console.log('[Transform] Server already has module.exports, writing as-is');
      return result;
    }
  }

  // Copy server dependencies to api folder if they exist
  // Handle both root-level files AND backend/ folder structure
  const filesToCopy = ['app.js', 'routes', 'models', 'controllers', 'middleware', 'config'];
  const dirsToCheck = [workDir, path.join(workDir, 'backend')];

  for (const baseDir of dirsToCheck) {
    for (const file of filesToCopy) {
      const srcPath = path.join(baseDir, file);
      const destPath = path.join(apiDir, file);
      if (fs.existsSync(srcPath)) {
        if (fs.statSync(srcPath).isDirectory()) {
          // Copy directory recursively
          await fsp.mkdir(destPath, { recursive: true });
          const subFiles = await fsp.readdir(srcPath);
          for (const subFile of subFiles) {
            const srcSub = path.join(srcPath, subFile);
            const destSub = path.join(destPath, subFile);
            if (fs.statSync(srcSub).isFile()) {
              await fsp.copyFile(srcSub, destSub);
            }
          }
        } else {
          await fsp.copyFile(srcPath, destPath);
        }
        result.files.push(file);
        console.log(`[Transform] Copied ${file} from ${path.basename(baseDir)}/ to api/`);
      }
    }
  }

  // Also copy any JS files from backend/src to api/ for full server logic
  const backendSrc = path.join(workDir, 'backend', 'src');
  if (fs.existsSync(backendSrc)) {
    const apiSrcDir = path.join(apiDir, 'src');
    await fsp.mkdir(apiSrcDir, { recursive: true });
    const backendFiles = await fsp.readdir(backendSrc);
    for (const bf of backendFiles) {
      if (bf.endsWith('.js')) {
        await fsp.copyFile(path.join(backendSrc, bf), path.join(apiSrcDir, bf));
        console.log(`[Transform] Copied backend/src/${bf} to api/src/`);
      }
    }
  }

  // Copy package.json deps to api folder (for node_modules access)
  const rootPkg = path.join(workDir, 'package.json');
  const apiPkg = path.join(apiDir, 'package.json');
  if (fs.existsSync(rootPkg)) {
    const pkgContent = await fsp.readFile(rootPkg, 'utf8');
    const pkg = JSON.parse(pkgContent);
    // Create minimal package.json for api folder with only dependencies
    const apiPkgJson = {
      name: 'api',
      version: '1.0.0',
      dependencies: pkg.dependencies || {}
    };
    await fsp.writeFile(apiPkg, JSON.stringify(apiPkgJson, null, 2));
    result.files.push('package.json');
    console.log('[Transform] Created api/package.json');
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
    // MERN stack - needs both Node.js API and static frontend build
    // Check if frontend folder exists to determine correct paths
    const hasFrontendFolder = fs.existsSync(path.join(workDir, 'frontend')) ||
                             fs.existsSync(path.join(workDir, 'client'));
    const frontendDist = hasFrontendFolder ? 'frontend/dist' : 'dist';

    vercelConfig = {
      version: 2,
      outputDirectory: frontendDist,
      builds: [
        {
          src: 'api/**/*.js',
          use: '@vercel/node'
        },
        {
          src: 'package.json',
          use: '@vercel/static-build',
          config: { distDir: frontendDist }
        }
      ],
      routes: [
        { "src": "/api/(.*)", "dest": "/api/index.js" },
        { "handle": "filesystem" },
        { "src": "/(.*)", "dest": "/index.html" }
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
  // and ensure backend dependencies are available
  if (projectType === 'MERN') {
    const pkgPath = path.join(workDir, 'package.json');
    try {
      const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
      pkg.scripts = pkg.scripts || {};

      // Check if frontend/ folder exists
      const frontendDir = path.join(workDir, 'frontend');
      const clientDir = path.join(workDir, 'client');
      const hasFrontendFolder = fs.existsSync(frontendDir) || fs.existsSync(clientDir);

      if (hasFrontendFolder) {
        pkg.scripts['vercel-build'] = 'cd frontend && npm install && npm run build && cd ..';
      } else {
        // Frontend is at root level (Vite default - builds to dist/)
        pkg.scripts['vercel-build'] = 'npm install && npm run build';
      }

      // Ensure backend dependencies are installed for serverless
      // Copy backend/package.json to api/package.json
      const backendPkgPath = path.join(workDir, 'backend', 'package.json');
      if (fs.existsSync(backendPkgPath)) {
        const backendPkg = JSON.parse(await fsp.readFile(backendPkgPath, 'utf8'));
        const apiPkgPath = path.join(workDir, 'api', 'package.json');
        const apiPkg = {
          name: 'api',
          version: '1.0.0',
          dependencies: {
            ...(backendPkg.dependencies || {}),
            ...(pkg.dependencies || {})
          }
        };
        await fsp.writeFile(apiPkgPath, JSON.stringify(apiPkg, null, 2));
        console.log('[Transform] Created api/package.json with backend deps');
      }

      await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      console.log('[Transform] Added vercel-build script to package.json');
    } catch (e) {
      console.log('[Transform] Error updating package.json:', e.message);
    }
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
  const hasFrontendFolder = fs.existsSync(path.join(workDir, 'frontend')) ||
                            fs.existsSync(path.join(workDir, 'client'));
  const frontendDist = hasFrontendFolder ? 'frontend/dist' : 'dist';

  const vercelConfig = {
    version: 2,
    outputDirectory: frontendDist,
    builds: [
      {
        src: 'api/**/*.js',
        use: '@vercel/node'
      },
      {
        src: 'package.json',
        use: '@vercel/static-build',
        config: { distDir: frontendDist }
      }
    ],
    routes: [
      { "src": "/api/(.*)", "dest": "/api/index.js" },
      { "handle": "filesystem" },
      { "src": "/(.*)", "dest": "/index.html" }
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