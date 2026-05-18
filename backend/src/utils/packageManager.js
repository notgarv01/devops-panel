const fs = require('fs-extra');
const path = require('path');

/**
 * Dependency Splitter Service
 * Analyzes and splits package.json for MERN stack deployment
 */

class DependencySplitter {
  constructor(aiService = null) {
    this.aiService = aiService;
  }

  /**
   * Main entry point: Split dependencies for MERN deployment
   */
  async splitDependencies(workDir, migrationPlan) {
    const results = {
      frontend: null,
      backend: null,
      success: false,
      errors: []
    };

    try {
      // Find root package.json
      const rootPkgPath = path.join(workDir, 'package.json');
      if (!await fs.pathExists(rootPkgPath)) {
        results.errors.push('No package.json found at root');
        return results;
      }

      const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf8'));
      const allDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };

      if (Object.keys(allDeps).length === 0) {
        results.errors.push('No dependencies found to split');
        return results;
      }

      // Use AI to intelligently split dependencies
      if (this.aiService?.generateDependencySplit) {
        const split = await this.aiService.generateDependencySplit(allDeps);
        if (split) {
          results.frontend = split.frontend;
          results.backend = split.backend;
          results.success = true;
        }
      }

      // Fallback to rule-based splitting
      if (!results.success) {
        results.frontend = this.ruleBasedSplit(allDeps).frontend;
        results.backend = this.ruleBasedSplit(allDeps).backend;
        results.success = true;
      }

      return results;
    } catch (error) {
      results.errors.push(error.message);
      return results;
    }
  }

  /**
   * Rule-based splitting (fallback when AI unavailable)
   */
  ruleBasedSplit(allDeps) {
    const frontendPatterns = [
      'react', 'vue', 'angular', 'svelte', 'next', 'nuxt',
      'vite', 'webpack', '@vitejs', 'tailwind', 'sass', 'less',
      'axios', 'fetch', 'router', 'redux', 'zustand', 'mobx',
      'material-ui', '@mui', 'chakra', 'styled-components', 'emotion',
      'framer-motion', 'react-native', 'expo', 'ionic',
      'vite', 'esbuild', 'rollup', 'parcel',
      'eslint', 'prettier', 'jest', 'cypress', 'testing-library'
    ];

    const backendPatterns = [
      'express', 'koa', 'fastify', 'hapi', 'sails',
      'mongoose', 'sequelize', 'typeorm', 'prisma', 'knex',
      'cors', 'helmet', 'dotenv', 'bcrypt', 'jsonwebtoken',
      'socket.io', 'ws', 'grpc', 'protobuf',
      'mongodb', 'mysql', 'postgres', 'redis', 'rabbitmq',
      'nodemailer', 'sendgrid', 'mailgun',
      'passport', 'acl', 'casbin',
      'sharp', 'cloudinary', 'aws-sdk', 'firebase-admin'
    ];

    const frontend = {};
    const backend = {};
    const shared = {};

    for (const [dep, version] of Object.entries(allDeps)) {
      const lowerDep = dep.toLowerCase();

      // Check frontend patterns
      const isFrontend = frontendPatterns.some(p => lowerDep.includes(p));
      // Check backend patterns
      const isBackend = backendPatterns.some(p => lowerDep.includes(p));

      if (isFrontend && !isBackend) {
        frontend[dep] = version;
      } else if (isBackend && !isFrontend) {
        backend[dep] = version;
      } else if (isFrontend && isBackend) {
        // Shared deps go to both
        frontend[dep] = version;
        backend[dep] = version;
      } else {
        // Unknown deps - default to frontend for React projects
        shared[dep] = version;
      }
    }

    return { frontend, backend, shared };
  }

  /**
   * Write split package.json files to disk
   */
  async writeSplitPackages(workDir, splitResults, rootPkg) {
    const results = { written: [], errors: [] };

    // Write frontend package.json
    if (splitResults.frontend && Object.keys(splitResults.frontend).length > 0) {
      const frontendPkg = {
        name: 'frontend',
        version: '1.0.0',
        private: true,
        dependencies: splitResults.frontend,
        scripts: rootPkg.scripts || { build: 'vite build' }
      };

      const frontendPath = path.join(workDir, 'frontend', 'package.json');
      await fs.ensureDir(path.dirname(frontendPath));
      await fs.writeFile(frontendPath, JSON.stringify(frontendPkg, null, 2));
      results.written.push(frontendPath);
      console.log(`[DepSplitter] Wrote frontend/package.json with ${Object.keys(splitResults.frontend).length} deps`);
    }

    // Write backend package.json
    if (splitResults.backend && Object.keys(splitResults.backend).length > 0) {
      const backendPkg = {
        name: 'backend',
        version: '1.0.0',
        private: true,
        dependencies: splitResults.backend,
        scripts: { start: 'node server.js' }
      };

      const backendPath = path.join(workDir, 'backend', 'package.json');
      await fs.ensureDir(path.dirname(backendPath));
      await fs.writeFile(backendPath, JSON.stringify(backendPkg, null, 2));
      results.written.push(backendPath);
      console.log(`[DepSplitter] Wrote backend/package.json with ${Object.keys(splitResults.backend).length} deps`);
    }

    return results;
  }
}

// Helper to split a package.json into frontend/backend
async function splitPackageJson(workDir) {
  const splitter = new DependencySplitter();

  // Find root package.json
  const rootPkgPath = path.join(workDir, 'package.json');
  if (!await fs.pathExists(rootPkgPath)) {
    return { success: false, error: 'No package.json found' };
  }

  const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf8'));
  const allDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };

  // Check if split already exists
  const frontendPkgPath = path.join(workDir, 'frontend', 'package.json');
  const backendPkgPath = path.join(workDir, 'backend', 'package.json');

  if (await fs.pathExists(frontendPkgPath) && await fs.pathExists(backendPkgPath)) {
    console.log('[DepSplitter] Packages already split, skipping');
    return { success: true, alreadySplit: true };
  }

  // Perform split
  const split = splitter.ruleBasedSplit(allDeps);

  // Write packages
  const writeResults = await splitter.writeSplitPackages(workDir, split, rootPkg);

  return {
    success: true,
    frontend: split.frontend,
    backend: split.backend,
    written: writeResults.written
  };
}

module.exports = { DependencySplitter, splitPackageJson };