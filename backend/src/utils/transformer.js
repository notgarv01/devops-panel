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
    // Zero-404 config - no builds array for MERN
    return {
      version: 2,
      buildCommand: 'cd frontend && npm install && npm run build',
      outputDirectory: 'frontend/dist',
      framework: 'vite',
      rewrites: [
        { source: '/api/(.*)', destination: '/api/index.js' },
        { source: '/(.*)', destination: '/index.html' }
      ]
    };
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

// ===== STEP 6: THE SERVERLESS ENTRY (The "Glue") =====
const injectServerlessBridge = async (workDir, audit) => {
  const apiDir = path.join(workDir, 'api');
  await fsp.mkdir(apiDir, { recursive: true });

  // The Serverless Entry Point - bridges Vercel to Express
  // Handles both ES module and CommonJS backend apps
  const bridgeContent = `// api/index.js (AUTO-GENERATED by DevOps Panel)
// Serverless Entry - Vercel → Express Bridge
const path = require('path');

// Dynamically import the Express app (handles both ESM and CJS)
const appPath = path.join(__dirname, '..', 'backend', 'src', 'app.js');

let app;
let handler;

// Try to load as CommonJS first
try {
  app = require(appPath);
  if (app.default) app = app.default;
  handler = app;
} catch (e) {
  // Fallback: Use ES module dynamic import for Vercel
}

// Vercel serverless handler
module.exports = async (req, res) => {
  try {
    if (!handler) {
      // Dynamic import for ES modules
      const appModule = await import('file://' + appPath);
      handler = appModule.default;
    }
    return handler(req, res);
  } catch (error) {
    console.error('API Error:', error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
`;

  const apiIndexPath = path.join(apiDir, 'index.js');
  await fsp.writeFile(apiIndexPath, bridgeContent);

  console.log('[Transform] === STEP 6: SERVERLESS ENTRY CREATED ===');
  console.log('  Bridge: api/index.js → ../backend/src/app');

  return { path: apiIndexPath, target: '../backend/src/app' };
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

// ===== STEP 8: THE GOLDEN VERCEL INJECTION (Zero-404) =====
const injectGoldenTemplate = async (workDir, audit) => {
  // Only use golden template if AI has standardized the structure
  const hasFrontend = fs.existsSync(path.join(workDir, 'frontend'));
  const hasApi = fs.existsSync(path.join(workDir, 'api'));

  if (!hasFrontend || !hasApi) {
    console.log('[Transform] Not using golden template - AI standardization incomplete');
    return null;
  }

  // Zero-404 Vercel config - no builds array, uses rewrites instead
  const goldenConfig = {
    "version": 2,
    "buildCommand": "cd frontend && npm install && npm run build",
    "outputDirectory": "frontend/dist",
    "framework": "vite",
    "rewrites": [
      { "source": "/api/(.*)", "destination": "/api/index.js" },
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  };

  const vercelJsonPath = path.join(workDir, 'vercel.json');
  await fsp.writeFile(vercelJsonPath, JSON.stringify(goldenConfig, null, 2));

  console.log('[Transform] === STEP 8: ZERO-404 CONFIG INJECTED ===');
  console.log('  Build: cd frontend && npm install && npm run build');
  console.log('  Output: frontend/dist');
  console.log('  Framework: vite');
  console.log('  Rewrites: /api/* -> /api/index.js, /* -> /index.html');
  console.log('  [No builds array - Vercel uses project settings correctly]');

  return { path: vercelJsonPath, config: goldenConfig, golden: true };
};

// ===== PHASE 3: ZERO-404 CONFIG GENERATION =====
// Generates vercel.json based on Phase 1 audit data
const generateTailoredConfig = async (workDir, audit) => {
  // Support both new audit structure and legacy discovery
  const frontend = audit.frontend || {};
  const backend = audit.backend || {};
  const frontendPath = frontend.path || audit.frontendPath || 'frontend';
  const backendPath = backend.path || audit.backendPath || 'backend';
  const buildScript = frontend.buildScript || audit.buildScript || 'npm run build';
  const outputDir = frontend.outDir || audit.outputDir || 'dist';

  if (!frontendPath) {
    console.log('[Transform] No frontend detected, skipping vercel.json generation');
    return null;
  }

  // Dynamic navigation based on audit
  const frontendDir = frontendPath === '.' ? '' : frontendPath;
  const buildCommand = frontendDir
    ? `cd ${frontendDir} && npm install && ${buildScript}`
    : `npm install && ${buildScript}`;

  // Output directory is relative to where buildCommand runs
  const outputDirectory = frontendDir
    ? path.join(frontendDir, outputDir)
    : outputDir;

  // Zero-404 config - no builds array (causes Vercel to skip builds)
  const vercelConfig = {
    version: 2,
    buildCommand: buildCommand,
    outputDirectory: outputDirectory,
    framework: 'vite',
    rewrites: [
      { source: '/api/(.*)', destination: '/api/index.js' },
      { source: '/(.*)', destination: '/index.html' }
    ]
  };

  const vercelJsonPath = path.join(workDir, 'vercel.json');
  await fsp.writeFile(vercelJsonPath, JSON.stringify(vercelConfig, null, 2));

  console.log('[Transform] === PHASE 3: ZERO-404 CONFIG GENERATED ===');
  console.log(`  Frontend: ${frontendPath}`);
  console.log(`  Build Command: ${buildCommand}`);
  console.log(`  Output Directory: ${outputDirectory}`);
  console.log(`  Backend: ${backendPath}`);
  console.log(`  isMERN: ${!!backendPath}`);

  return { path: vercelJsonPath, config: vercelConfig, audit };
};

// Main transform function
const transformForDeployment = async (workDir, projectType, options = {}) => {
  console.log('===========================================');
  console.log('[Transform] FUNCTION STARTED');
  console.log(`[Transform] workDir: ${workDir}`);
  console.log(`[Transform] projectType: "${projectType}"`);
  console.log(`[Transform] options.discovery:`, options.discovery || 'none');
  console.log('===========================================');

  const results = {
    vercelJson: null,
    serverTransformed: null,
    files: [],
    transformations: []
  };

  // Get discovery/audit data if available
  const discovery = options.discovery || {};

  // STEP 8: Try golden template first if AI has standardized structure
  if (projectType === 'MERN' || projectType === 'FRONTEND') {
    const hasFrontend = fs.existsSync(path.join(workDir, 'frontend'));
    const hasApi = fs.existsSync(path.join(workDir, 'api'));

    if (hasFrontend && hasApi && discovery.architectRecommendations?.length > 0) {
      // AI has standardized - use Golden Template
      const golden = await injectGoldenTemplate(workDir, discovery);
      if (golden) {
        results.vercelJson = golden;
        results.files.push(golden.path);
        results.transformations.push({ type: 'vercel_json_golden', path: golden.path });
        console.log('[Transform] Using Golden Template (AI-standardized structure detected)');
      }

      // STEP 6: Create Serverless Bridge (always, even without AI)
      if (discovery.backend?.path || fs.existsSync(path.join(workDir, 'backend'))) {
        const bridge = await injectServerlessBridge(workDir, discovery);
        if (bridge) {
          results.transformations.push({ type: 'serverless_bridge', path: bridge.path });
        }
      }
    }

    // Fall back to tailored config if golden wasn't applied
    if (!results.vercelJson) {
      const tailoredConfig = await generateTailoredConfig(workDir, discovery);
      if (tailoredConfig) {
        results.vercelJson = tailoredConfig;
        results.files.push(tailoredConfig.path);
        results.transformations.push({ type: 'vercel_json', path: tailoredConfig.path });
      }

      // Also create serverless bridge in fallback
      if (fs.existsSync(path.join(workDir, 'backend'))) {
        const bridge = await injectServerlessBridge(workDir, discovery);
        if (bridge) {
          results.transformations.push({ type: 'serverless_bridge', path: bridge.path });
        }
      }
    }
  } else {
    // For other project types, use the original logic
    const vercelConfig = generateVercelConfig(projectType, options);
    const vercelJsonPath = path.join(workDir, 'vercel.json');
    await fsp.writeFile(vercelJsonPath, JSON.stringify(vercelConfig, null, 2));
    results.vercelJson = { path: vercelJsonPath, config: vercelConfig };
    results.files.push(vercelJsonPath);
    results.transformations.push({ type: 'vercel_json', path: vercelJsonPath });
  }

  // Continue with server transformation for MERN/NODE_API
  const mernResult = await detectMernStack(workDir);
  if (mernResult.isMern) {
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

exports.transformForDeployment = transformForDeployment;
exports.generateVercelConfig = generateVercelConfig;
exports.findServerFile = findServerFile;
exports.transformServerFile = transformServerFile;
exports.ensureApiFolder = ensureApiFolder;