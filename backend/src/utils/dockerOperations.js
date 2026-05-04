const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const DEPLOY_WORK_DIR = path.join(os.tmpdir(), 'deploys');
const BASE_PORT = 30000;
const MAX_PORT = 60000;

// Track used ports
let usedPorts = new Set();

// Get next available port
const getNextPort = async () => {
  // First, check what ports are actually in use by running containers
  try {
    const result = await execPromise('docker ps --format "{{.Ports}}"');
    const portMatches = result.match(/0\.0\.0\.0:(\d+)/g) || [];
    portMatches.forEach(match => {
      const port = parseInt(match.replace('0.0.0.0:', ''));
      usedPorts.add(port);
    });
  } catch (error) {
    console.log('Could not get running container ports');
  }

  // Find next available port
  for (let port = BASE_PORT; port < MAX_PORT; port++) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }

  throw new Error('No available ports');
};

// Generate project name from Git URL
const generateProjectName = (repoUrl) => {
  const match = repoUrl.match(/\/([^\/]+)\/?$/);
  return match ? match[1].replace(/[^a-zA-Z0-9-_]/g, '-') : `project-${Date.now()}`;
};

// Execute command with streaming output
const execPromise = (command, options = {}) => {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, {
      shell: true,
      ...options
    });

    if (options.stdoutCallback) {
      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        options.stdoutCallback(text);
      });
    } else {
      child.stdout.on('data', (data) => stdout += data.toString());
    }

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (options.stderrCallback) {
        options.stderrCallback(text);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
};

// Clone repository
const cloneRepository = async (repoUrl, branch = 'main', workDir) => {
  try {
    // Remove existing directory if it exists
    await fs.rm(workDir, { recursive: true, force: true });

    // Create work directory
    await fs.mkdir(workDir, { recursive: true });

    // Try specified branch first
    try {
      await execPromise(
        `git clone --branch ${branch} --depth 1 ${repoUrl} ${workDir}`,
        { cwd: workDir }
      );
    } catch (cloneError) {
      // If branch not found, clean up and try full clone then checkout
      await fs.rm(workDir, { recursive: true, force: true });
      await fs.mkdir(workDir, { recursive: true });

      // Full clone, then checkout the branch
      await execPromise(`git clone ${repoUrl} ${workDir}`, { cwd: workDir });

      // Try to checkout the specified branch
      try {
        await execPromise(`git checkout ${branch}`, { cwd: workDir });
      } catch (checkoutError) {
        // If branch doesn't exist, get the default branch
        const defaultBranch = await execPromise('git symbolic-ref refs/remotes/origin/HEAD', { cwd: workDir });
        const branchName = defaultBranch.replace('refs/remotes/origin/', '').trim();
        await execPromise(`git checkout ${branchName}`, { cwd: workDir });
      }
    }

    // Get commit hash
    const commitHash = await execPromise('git rev-parse HEAD', { cwd: workDir });

    return { success: true, commitHash };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Detect project type and generate Dockerfile
const generateDockerfile = async (workDir) => {
  const packageJsonPath = path.join(workDir, 'package.json');
  const hasPackageJson = await fs.access(packageJsonPath).then(() => true).catch(() => false);

  if (hasPackageJson) {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};
    const hasBuild = scripts.build;
    const hasDev = scripts.dev;

    // Node.js project
    if (hasBuild) {
      // React/Vue/Next.js - production build
      return `
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist ./usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
      `;
    } else if (hasDev) {
      // Development server (Node/Express)
      return `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
      `;
    } else {
      // Simple Node server
      return `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
      `;
    }
  }

  // Static site or other
  return `
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
  `;
};

// Build Dockerfile directly from cloned repo
const buildDockerfileDirect = async (workDir, imageName) => {
  try {
    // Generate Dockerfile if it doesn't exist
    const dockerfilePath = path.join(workDir, 'Dockerfile');
    const hasDockerfile = await fs.access(dockerfilePath).then(() => true).catch(() => false);

    if (!hasDockerfile) {
      const dockerfile = await generateDockerfile(workDir);
      await fs.writeFile(dockerfilePath, dockerfile);
    }

    // Build the image
    await execPromise(
      `docker build -t ${imageName} ${workDir}`,
      { cwd: workDir }
    );

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Run container
const runContainer = async (imageName, deploymentId, hostPort) => {
  try {
    const containerName = `deploy-${deploymentId}`;

    // Stop existing container with same name if exists
    try {
      await execPromise(`docker rm -f ${containerName}`);
    } catch (e) {
      // Container doesn't exist, that's fine
    }

    // Run new container
    await execPromise(
      `docker run -d --name ${containerName} -p ${hostPort}:3000 ${imageName}`
    );

    // Get container ID
    const containerId = await execPromise(`docker ps -q --filter name=${containerName}`);

    return {
      success: true,
      containerId: containerId.trim(),
      hostPort
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Stop container
const stopContainer = async (containerId) => {
  try {
    await execPromise(`docker stop ${containerId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Remove container
const removeContainer = async (containerId) => {
  try {
    await execPromise(`docker rm -f ${containerId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Remove image
const removeImage = async (imageName) => {
  try {
    await execPromise(`docker rmi -f ${imageName}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Start existing container
const startContainer = async (containerId) => {
  try {
    await execPromise(`docker start ${containerId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Cleanup dead containers
const cleanupDeadContainers = async () => {
  try {
    // Get all stopped containers
    const stopped = await execPromise('docker ps -a --filter "name=deploy-" --format "{{.Names}}"');
    const names = stopped.split('\n').filter(n => n.trim());

    for (const name of names) {
      try {
        await execPromise(`docker rm -f ${name}`);
        console.log(`Cleaned up: ${name}`);
      } catch (e) {
        // Ignore individual failures
      }
    }
  } catch (error) {
    console.log('Cleanup check complete');
  }
};

// Create Docker network
const createNetwork = async (networkName) => {
  try {
    await execPromise(`docker network create ${networkName}`);
    return { success: true };
  } catch (error) {
    if (error.message.includes('already exists')) {
      return { success: true };
    }
    return { success: false, error: error.message };
  }
};

// Remove Docker network
const removeNetwork = async (networkName) => {
  try {
    await execPromise(`docker network rm ${networkName}`);
    return { success: true };
  } catch (error) {
    if (error.message.includes('No such network')) {
      return { success: true };
    }
    return { success: false, error: error.message };
  }
};

// Run docker-compose
const runDockerCompose = async (deploymentId, workDir, stdoutCallback, stderrCallback) => {
  try {
    const options = { cwd: workDir };
    if (stdoutCallback) options.stdoutCallback = stdoutCallback;
    if (stderrCallback) options.stderrCallback = stderrCallback;

    // Try docker compose (new) first, fallback to docker-compose (legacy)
    try {
      await execPromise(`docker compose up -d --build`, options);
    } catch {
      // Fallback to standalone docker-compose
      await execPromise(`docker-compose up -d --build`, options);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Stop docker-compose
const stopDockerCompose = async (workDir) => {
  try {
    await execPromise(`docker compose down`, { cwd: workDir });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Get containers from docker-compose
const getComposeContainers = async (deploymentId) => {
  const containers = [];
  const serviceNames = ['app', 'mongo', 'redis', 'frontend'];

  for (const name of serviceNames) {
    try {
      const containerName = `deploy-${deploymentId}-${name}`;
      const result = await execPromise(
        `docker ps --filter name=${containerName} --format "{{.ID}}|{{.Ports}}"`
      );

      if (result && result.trim()) {
        const [id, ports] = result.split('|');
        const portMatch = ports ? ports.match(/(\d+)->/) : null;

        let type = 'node';
        let containerPort = 3000;
        if (name === 'mongo') { type = 'mongo'; containerPort = 27017; }
        else if (name === 'frontend') { type = 'nginx'; containerPort = 80; }
        else if (name === 'redis') { type = 'redis'; containerPort = 6379; }

        containers.push({
          name,
          containerId: id.trim(),
          containerName,
          type,
          containerPort,
          hostPort: portMatch ? parseInt(portMatch[1]) : null
        });
      }
    } catch (e) {
      // Service might not exist
    }
  }

  return containers;
};

// Remove docker-compose (down + remove volumes)
const removeDockerCompose = async (workDir, withVolumes = true) => {
  try {
    const cmd = withVolumes ? 'docker compose down -v' : 'docker compose down';
    await execPromise(cmd, { cwd: workDir });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Check if MongoDB port is available
const isMongoPortAvailable = async () => {
  try {
    const result = await execPromise('docker ps --format "{{.Ports}}"');
    return !result.includes(':27017');
  } catch {
    return true;
  }
};

module.exports = {
  generateProjectName,
  getNextPort,
  cloneRepository,
  buildDockerfileDirect,
  runContainer,
  stopContainer,
  removeContainer,
  removeImage,
  startContainer,
  cleanupDeadContainers,
  createNetwork,
  removeNetwork,
  runDockerCompose,
  stopDockerCompose,
  getComposeContainers,
  removeDockerCompose,
  isMongoPortAvailable
};