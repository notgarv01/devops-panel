const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const PROJECT_TYPES = require('./analyzer').PROJECT_TYPES;

// Helper: Convert ES modules to CommonJS
const convertToCommonJS = (content) => {
  let result = content;

  // Convert: import x from 'y' -> const x = require('y')
  result = result.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, "const $1 = require('$2')");

  // Convert: import { x, y } from 'z' -> const { x, y } = require('z')
  result = result.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g, "const { $1 } = require('$2')");

  // Convert: import * as x from 'y' -> const x = require('y')
  result = result.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, "const $1 = require('$2')");

  // Convert: import 'x' (side effect only) -> require('x')
  result = result.replace(/import\s+['"]([^'"]+)['"]/g, "require('$1')");

  // Convert: export default x -> module.exports = x
  result = result.replace(/export\s+default\s+(.+?);?\s*$/gm, 'module.exports = $1;');
  result = result.replace(/export\s+default\s+/g, 'module.exports = ');

  // Convert: export const/let/var x -> const/let/var x (remove export)
  result = result.replace(/export\s+(const|let|var)\s+/g, '$1 ');

  return result;
};

// Helper: Transform a single JS file to CommonJS
const transformJsFile = async (filePath) => {
  try {
    let content = await fsp.readFile(filePath, 'utf8');
    const originalContent = content;

    // Remove app.listen (only in server files)
    content = content.replace(/app\.listen\s*\(.*\);?/g, '');
    content = content.replace(/server\.listen\s*\(.*\);?/g, '');

    // Check if uses ES modules
    const usesEsModules = /^\s*import\s+/m.test(content);

    if (usesEsModules) {
      content = convertToCommonJS(content);
    }

    // Ensure module.exports if needed
    if (filePath.endsWith('server.js') || filePath.endsWith('index.js')) {
      if (!/module\.exports/.test(content) && /const\s+app\s*=/.test(content)) {
        content = content.trim() + '\n\nmodule.exports = app;\n';
      }
    }

    if (content !== originalContent) {
      await fsp.writeFile(filePath, content, 'utf8');
      console.log(`[Transform] Converted: ${path.basename(filePath)}`);
      return true;
    }
    return false;
  } catch (err) {
    console.log(`[Transform] Error transforming ${filePath}:`, err.message);
    return false;
  }
};

// Helper: Recursively transform all JS files in a directory
const transformAllJsFiles = async (dir, depth = 0) => {
  if (depth > 5) return;

  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          await transformAllJsFiles(fullPath, depth + 1);
        }
      } else if (entry.name.endsWith('.js')) {
        await transformJsFile(fullPath);
      }
    }
  } catch (err) {
    console.log(`[Transform] Error scanning ${dir}:`, err.message);
  }
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
    baseConfig.rewrites = [
      { source: '/(.*)', destination: '/api/index.js' }
    ];
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

  const hasAppListen = /app\.listen\s*\(/.test(content);
  const hasModuleExports = /module\.exports/.test(content);

  if (hasAppListen || !hasModuleExports) {
    // Remove app.listen
    let transformedContent = content.replace(/app\.listen\s*\(.*\);?/g, '');
    transformedContent = transformedContent.replace(/server\.listen\s*\(.*\);?/g, '');

    // Check if file uses ES modules
    const usesEsModules = /^\s*import\s+/m.test(transformedContent);

    // Convert ES modules to CommonJS
    if (usesEsModules) {
      console.log('[Transform] Converting ES modules to CommonJS');
      transformedContent = convertToCommonJS(transformedContent);
    }

    // Ensure module.exports exists
    if (!/module\.exports/.test(transformedContent)) {
      transformedContent = transformedContent.trim() + '\n\nmodule.exports = app;\n';
    }

    // Write the transformed server.js to api folder
    const transformedServerPath = path.join(apiDir, 'server.js');
    await fsp.writeFile(transformedServerPath, transformedContent);
    console.log('[Transform] Wrote transformed server.js to api/');

    // Generate handler that properly requires app.js from api/src/
    // Optimized for CommonJS - waits for MongoDB before processing
    const standaloneHandler = `
const app = require('../backend/src/app');
const mongoose = require('mongoose');

module.exports = async (req, res) => {
  // Wait for MongoDB to be READY before processing any request
  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(process.env.MONGO_URI);
    } catch (err) {
      return res.status(500).json({ success: false, error: "DATABASE_CONNECTION_FAILED" });
    }
  }

  try {
    return app(req, res);
  } catch (error) {
    return res.status(500).json({ success: false, error: "APP_RUNTIME_ERROR", message: error.message });
  }
};`;

    await fsp.writeFile(apiIndexPath, standaloneHandler);
    result.transformed = true;
    result.files.push(apiIndexPath);
    console.log('[Transform] Wrote serverless handler to api/index.js');

    // Don't return yet - still need to copy dependencies
  } else {
    const existingExport = content.match(/module\.exports\s*=\s*(.+)/)?.[1];
    if (existingExport) {
      await fsp.writeFile(apiIndexPath, content);
      result.transformed = false;
      result.files.push(apiIndexPath);
      console.log('[Transform] Server already has module.exports, writing as-is');
      // Don't return yet - still need to copy dependencies
    }
  }

  // Copy server dependencies to api folder
  const filesToCopy = ['app.js', 'routes', 'models', 'controllers', 'middleware', 'config'];
  const dirsToCheck = [workDir, path.join(workDir, 'backend')];

  for (const baseDir of dirsToCheck) {
    for (const file of filesToCopy) {
      const srcPath = path.join(baseDir, file);
      const destPath = path.join(apiDir, file);
      if (fs.existsSync(srcPath)) {
        if (fs.statSync(srcPath).isDirectory()) {
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

  // Copy backend/src to api/src (recursively for full backend code)
  const backendSrc = path.join(workDir, 'backend', 'src');
  if (fs.existsSync(backendSrc)) {
    const copyDirRecursive = async (src, dest) => {
      await fsp.mkdir(dest, { recursive: true });
      const entries = await fsp.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await copyDirRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
          await fsp.copyFile(srcPath, destPath);
        }
      }
    };
    await copyDirRecursive(backendSrc, path.join(apiDir, 'src'));
    console.log(`[Transform] Copied backend/src/ to api/src/`);
  }

  // Verify app.js exists
  const appJsPath = path.join(apiDir, 'src', 'app.js');
  if (fs.existsSync(appJsPath)) {
    console.log(`[Transform] Verified api/src/app.js exists`);
  } else {
    console.log(`[Transform] WARNING: api/src/app.js not found!`);
  }

  // Transform ALL JS files in api folder to CommonJS
  await transformAllJsFiles(apiDir);
  console.log('[Transform] Converted all JS files in api/ to CommonJS');

  // Copy package.json deps
  const rootPkg = path.join(workDir, 'package.json');
  const apiPkg = path.join(apiDir, 'package.json');
  if (fs.existsSync(rootPkg)) {
    const pkgContent = await fsp.readFile(rootPkg, 'utf8');
    const pkg = JSON.parse(pkgContent);
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

const injectNowJson = async (workDir, projectType) => {
  const nowConfig = {
    version: 2,
    ...generateVercelConfig(projectType)
  };
  const nowJsonPath = path.join(workDir, 'now.json');
  await fsp.writeFile(nowJsonPath, JSON.stringify(nowConfig, null, 2));
  return { path: nowJsonPath, config: nowConfig };
};

const injectPackageJsonType = async (workDir) => {
  const pkgPath = path.join(workDir, 'package.json');
  try {
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
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
  console.log('===========================================');

  const results = {
    vercelJson: null,
    serverTransformed: null,
    files: [],
    transformations: []
  };

  const mernResult = await detectMernStack(workDir);
  if (mernResult.isMern) {
    results.mernStructure = mernResult;
    console.log(`[Transform] MERN stack detected! Has frontend: ${mernResult.hasClient}, Has backend: ${mernResult.hasServer}`);

    const frontendPath = path.join(workDir, mernResult.clientDir || 'frontend');
    const frontendPkgPath = path.join(frontendPath, 'package.json');

    if (fs.existsSync(frontendPkgPath)) {
      projectType = 'MERN';
      console.log(`[Transform] Switching to MERN config for full-stack deployment`);
    }
  }

  // Find and transform server file
  let serverFileFound = false;
  if (projectType === PROJECT_TYPES.NODE_API || projectType === 'NODE_API' || projectType === 'MERN') {
    const serverFile = await findServerFile(workDir);
    console.log(`[Transform] findServerFile result:`, serverFile);

    if (serverFile) {
      serverFileFound = true;
      console.log(`[Transform] Found server file: ${serverFile.path}`);
      const fileInfo = await checkApiPattern(serverFile.path);

      if (!fileInfo.hasModuleExports || fileInfo.hasListen) {
        const transformResult = await transformServerFile(workDir, {
          path: serverFile.path,
          content: fileInfo.content
        });
        results.serverTransformed = { found: true, ...transformResult };
        results.transformations.push({ type: 'server_transform', ...transformResult });
      } else {
        const apiDir = await ensureApiFolder(workDir);
        const apiIndexPath = path.join(apiDir, 'index.js');
        await fsp.copyFile(serverFile.path, apiIndexPath);
        results.serverTransformed = { found: true, moved: true, files: [apiIndexPath] };
        results.transformations.push({ type: 'server_move', from: serverFile.path, to: apiIndexPath });
      }
    }
  }

  // Generate vercel.json
  console.log('----------- VERCEL.JSON GENERATION -----------');
  console.log(`[Transform] projectType at vercel.json: "${projectType}"`);

  let vercelConfig;
  if (projectType === 'MERN') {
    const hasFrontendFolder = fs.existsSync(path.join(workDir, 'frontend')) ||
                             fs.existsSync(path.join(workDir, 'client'));
    const frontendDist = hasFrontendFolder ? 'frontend/dist' : 'dist';

    vercelConfig = {
      version: 2,
      outputDirectory: frontendDist,
      buildCommand: hasFrontendFolder ? "cd frontend && npm install && npm run build" : "npm install && npm run build",
      builds: [
        { src: 'api/**/*.js', use: '@vercel/node' },
        { src: 'package.json', use: '@vercel/static-build', config: { distDir: frontendDist } }
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
    console.log(`[Transform] Created fresh vercelConfig for MERN`);
  } else {
    vercelConfig = generateVercelConfig(projectType, options);
  }

  const vercelJsonPath = path.join(workDir, 'vercel.json');
  await fsp.writeFile(vercelJsonPath, JSON.stringify(vercelConfig, null, 2));
  results.vercelJson = { path: vercelJsonPath, config: vercelConfig };
  results.files.push(vercelJsonPath);
  results.transformations.push({ type: 'vercel_json', path: vercelJsonPath });

  // Remove "type": "module" from package.json
  const pkgResult = await injectPackageJsonType(workDir);
  if (pkgResult.updated) {
    results.files.push(pkgResult.path);
    results.transformations.push({ type: 'package_json_esm', path: pkgResult.path });
  }

  // For MERN, update root package.json
  if (projectType === 'MERN') {
    const pkgPath = path.join(workDir, 'package.json');
    try {
      const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
      pkg.scripts = pkg.scripts || {};

      const hasFrontendFolder = fs.existsSync(path.join(workDir, 'frontend')) ||
                                 fs.existsSync(path.join(workDir, 'client'));

      if (hasFrontendFolder) {
        pkg.scripts['vercel-build'] = 'cd frontend && npm install && npm run build && cd ..';
      } else {
        pkg.scripts['vercel-build'] = 'npm install && npm run build';
      }

      await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      console.log('[Transform] Added vercel-build script to package.json');
    } catch (e) {
      console.log('[Transform] Error updating package.json:', e.message);
    }
  }

  console.log(`[Transform] Completed ${results.transformations.length} transformations`);
  return results;
};

const detectMernStack = async (workDir) => {
  const entries = await fsp.readdir(workDir, { withFileTypes: true });
  const directories = entries.filter(e => e.isDirectory()).map(e => e.name.toLowerCase());

  const hasServer = directories.some(d => ['server', 'backend', 'api', 'app'].includes(d));
  const hasClient = directories.some(d => ['client', 'frontend', 'app', 'web', 'ui'].includes(d));

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

exports.generateVercelConfig = generateVercelConfig;
exports.findServerFile = findServerFile;
exports.transformServerFile = transformServerFile;
exports.ensureApiFolder = ensureApiFolder;