const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const Deploy = require('../models/Deploy');
const {
  generateProjectName,
  getNextPort,
  cloneRepository,
  buildDockerImage,
  runContainer,
  stopContainer,
  removeContainer,
  removeImage,
  buildDockerfileDirect,
  createNetwork,
  removeNetwork,
  runDockerCompose,
  stopDockerCompose,
  getComposeContainers,
  removeDockerCompose
} = require('../utils/dockerOperations');
const { detectStackType } = require('../utils/detectStack');
const {
  generateCompose,
  generateServerDockerfile,
  generateFrontendDockerfile,
  generateNginxConfig
} = require('../utils/composeGenerator');
const fs = require('fs').promises;
// const path = require('path');

const log = (io, deploymentId, level, message) => {
  const logEntry = {
    timestamp: new Date(),
    level,
    message
  };

  // Update DB
  Deploy.findByIdAndUpdate(deploymentId, {
    $push: { logs: logEntry }
  }).catch(err => console.error('Failed to save log:', err));

  // Emit to socket
  io.to(deploymentId).emit('deployment-log', { deploymentId, ...logEntry });
};

const sanitizeGitUrl = (url) => {
  // Remove .git suffix and extract project name
  let cleanUrl = url.trim();
  if (cleanUrl.endsWith('.git')) {
    cleanUrl = cleanUrl.slice(0, -4);
  }
  return cleanUrl;
};

exports.deploy = async (req, res) => {
  const { repoUrl, branch = 'main', envVars = [], projectName: customName, projectType = 'single' } = req.body;
  const io = req.app.get('io');

  if (!repoUrl) {
    return res.status(400).json({ error: 'Repository URL is required' });
  }

  try {
    // Generate project name from URL if not provided
    const repoUrlClean = sanitizeGitUrl(repoUrl);
    const projectName = customName || generateProjectName(repoUrlClean);
    const containerPort = 3000;
    const hostPort = await getNextPort();

    // Create deployment record
    const deployment = new Deploy({
      projectName,
      repoUrl: repoUrlClean,
      branch,
      containerPort,
      hostPort,
      projectType,
      status: 'pending',
      envVars
    });

    await deployment.save();

    // Return immediately - deployment runs in background
    res.status(201).json({
      message: 'Deployment started',
      deploymentId: deployment._id,
      projectName,
      hostPort,
      projectType
    });

    // Start deployment process asynchronously
    startDeployment(deployment._id.toString(), repoUrlClean, branch, envVars, io, projectType);

  } catch (error) {
    console.error('Deployment error:', error);
    res.status(500).json({ error: 'Failed to start deployment' });
  }
};

const startDeployment = async (deploymentId, repoUrl, branch, envVars, io, projectType = 'single') => {
  const workDir = path.join(os.tmpdir(), 'deploys', deploymentId);

  try {
    // Update status: cloning
    await Deploy.findByIdAndUpdate(deploymentId, { status: 'cloning' });
    log(io, deploymentId, 'info', 'Starting deployment...');

    // Step 1: Clone repository
    log(io, deploymentId, 'info', `Cloning repository: ${repoUrl}`);
    const cloneResult = await cloneRepository(repoUrl, branch, workDir);

    if (!cloneResult.success) {
      throw new Error(`Clone failed: ${cloneResult.error}`);
    }
    log(io, deploymentId, 'success', 'Repository cloned successfully');

    // Get commit hash
    const commitHash = cloneResult.commitHash;
    await Deploy.findByIdAndUpdate(deploymentId, { commitHash });

    // Step 2: Detect or validate project type
    let detectedType = projectType;
    if (projectType === 'auto') {
      const detection = await detectStackType(workDir);
      detectedType = detection.type;
      log(io, deploymentId, 'info', `Detected project type: ${detectedType}`);
    }

    // Step 3: Route to appropriate deployment handler
    if (detectedType === 'mern') {
      await startMernDeployment(deploymentId, workDir, envVars, io);
    } else {
      await startSingleDeployment(deploymentId, workDir, envVars, io);
    }

  } catch (error) {
    console.error(`Deployment ${deploymentId} failed:`, error);
    await Deploy.findByIdAndUpdate(deploymentId, {
      status: 'error',
      $push: { logs: { timestamp: new Date(), level: 'error', message: error.message } }
    });
    log(io, deploymentId, 'error', `Deployment failed: ${error.message}`);
  }
};

const startSingleDeployment = async (deploymentId, workDir, envVars, io) => {
  const imageName = `deploy-${deploymentId}`;

  try {
    // Update status: building
    await Deploy.findByIdAndUpdate(deploymentId, { status: 'building' });
    log(io, deploymentId, 'info', 'Building Docker image...');

    const buildResult = await buildDockerfileDirect(workDir, imageName);

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error}`);
    }
    log(io, deploymentId, 'success', 'Docker image built successfully');

    // Get host port
    const deployment = await Deploy.findById(deploymentId);
    const hostPort = deployment.hostPort || 30000;

    // Run container
    await Deploy.findByIdAndUpdate(deploymentId, { status: 'running' });
    log(io, deploymentId, 'info', 'Starting container...');

    const runResult = await runContainer(imageName, deploymentId, hostPort);

    if (!runResult.success) {
      throw new Error(`Container start failed: ${runResult.error}`);
    }

    await Deploy.findByIdAndUpdate(
      deploymentId,
      {
        containerId: runResult.containerId,
        status: 'running',
        deployedAt: new Date()
      },
      { new: true }
    );

    log(io, deploymentId, 'success', `Container running on port ${runResult.hostPort}`);
    log(io, deploymentId, 'info', `Deployment URL: http://localhost:${runResult.hostPort}`);

  } catch (error) {
    throw error;
  }
};

const startMernDeployment = async (deploymentId, workDir, envVars, io) => {
  const networkName = `mern-${deploymentId}`;
  const dbName = deploymentId.replace(/-/g, '_');

  try {
    // Get ports
    const deployment = await Deploy.findById(deploymentId);
    const serverPort = deployment.hostPort || await getNextPort();
    const frontendPort = await getNextPort();
    const mongoPort = await getNextPort();  // Dynamic port to avoid conflicts

    // Detect project structure
    const structure = await detectStackType(workDir);
    const backendDir = structure.backendDir || 'server';
    const hasFrontend = structure.hasFrontend;
    const detectedFrontendDir = structure.frontendDir || 'client';

    // Update status: building
    await Deploy.findByIdAndUpdate(deploymentId, {
      status: 'building',
      hostPort: serverPort
    });

    log(io, deploymentId, 'info', 'Setting up MERN stack deployment...');
    log(io, deploymentId, 'info', `Backend: ./${backendDir}, Frontend: ${hasFrontend ? 'detected (' + detectedFrontendDir + ')' : 'not detected'}`);

    // Determine where to write files
    const serverBasePath = backendDir === '.' ? workDir : path.join(workDir, backendDir);

    // Ensure the directory exists before writing files
    await fs.mkdir(serverBasePath, { recursive: true });
    console.log('[deploy] Ensuring directory exists:', serverBasePath);

    // Generate and write server Dockerfile
    const serverDockerfile = await generateServerDockerfile(workDir, backendDir);
    await fs.writeFile(path.join(serverBasePath, 'Dockerfile'), serverDockerfile);
    console.log('[deploy] Written Dockerfile to:', path.join(serverBasePath, 'Dockerfile'));
    log(io, deploymentId, 'info', 'Generated server Dockerfile');

    // Generate and write frontend Dockerfile if needed
    if (hasFrontend) {
      const frontendBasePath = path.join(workDir, detectedFrontendDir);

      // Ensure frontend directory exists
      await fs.mkdir(frontendBasePath, { recursive: true });

      const frontendDockerfile = await generateFrontendDockerfile(workDir, detectedFrontendDir, `http://localhost:${serverPort}`);
      await fs.writeFile(path.join(frontendBasePath, 'Dockerfile'), frontendDockerfile);

      // Generate nginx config
      const nginxConfig = generateNginxConfig(`http://app:${serverPort}`);
      await fs.writeFile(path.join(frontendBasePath, 'nginx.conf'), nginxConfig);
      log(io, deploymentId, 'info', 'Generated frontend Dockerfile and nginx config');
      log(io, deploymentId, 'info', `Frontend API URL set to: http://localhost:${serverPort}`);
    }

    // Generate and write docker-compose.yml
    const composeContent = await generateCompose(deploymentId, {
      serverPort,
      mongoPort,
      frontendPort,
      envVars,
      hasFrontend,
      hasRedis: true,
      backendDir,
      frontendDir: hasFrontend ? detectedFrontendDir : null,
      dbName
    });

    await fs.writeFile(path.join(workDir, 'docker-compose.yml'), composeContent);
    log(io, deploymentId, 'success', 'Generated docker-compose.yml (MongoDB + Redis + App)');

    // Create Docker network
    log(io, deploymentId, 'info', `Creating network: ${networkName}`);
    await createNetwork(networkName);

    // Build and start with docker-compose
    log(io, deploymentId, 'info', 'Building and starting containers...');
    await Deploy.findByIdAndUpdate(deploymentId, { status: 'building' });

    const composeResult = await runDockerCompose(
      deploymentId,
      workDir,
      (msg) => log(io, deploymentId, 'info', `[docker] ${msg.trim()}`),
      (msg) => log(io, deploymentId, 'warning', `[docker] ${msg.trim()}`)
    );

    if (!composeResult.success) {
      throw new Error(`Docker Compose failed: ${composeResult.error}`);
    }

    // Wait a moment for containers to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get container info
    const containers = await getComposeContainers(deploymentId);
    console.log('[deploy] containers:', JSON.stringify(containers, null, 2));

    // Update deployment record
    try {
      await Deploy.findByIdAndUpdate(deploymentId, {
        $set: {
          containers: containers || [],
          networkName,
          composeFile: path.join(workDir, 'docker-compose.yml'),
          status: 'running',
          deployedAt: new Date()
        }
      });
    } catch (updateError) {
      console.error('[deploy] Error updating deployment:', updateError.message);
      // Try without containers if that fails
      try {
        await Deploy.findByIdAndUpdate(deploymentId, {
          $set: {
            networkName,
            composeFile: path.join(workDir, 'docker-compose.yml'),
            status: 'running',
            deployedAt: new Date()
          }
        });
      } catch (fallbackError) {
        console.error('[deploy] Fallback update also failed:', fallbackError.message);
      }
    }

    log(io, deploymentId, 'success', 'MERN stack deployed successfully!');

    // Log service URLs
    const appContainer = containers.find(c => c.name === 'app');
    const frontendContainer = containers.find(c => c.name === 'frontend');

    if (appContainer && appContainer.hostPort) {
      log(io, deploymentId, 'info', `API: http://localhost:${appContainer.hostPort}`);
    }
    if (frontendContainer && frontendContainer.hostPort) {
      log(io, deploymentId, 'info', `Frontend: http://localhost:${frontendContainer.hostPort}`);
    }
    log(io, deploymentId, 'info', `MongoDB: localhost:27017`);

  } catch (error) {
    throw error;
  }
};

exports.getDeployments = async (req, res) => {
  try {
    const deployments = await Deploy.find({ status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 });
    res.json(deployments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
};

exports.getDeployment = async (req, res) => {
  try {
    const deployment = await Deploy.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    res.json(deployment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deployment' });
  }
};

exports.stopDeployment = async (req, res) => {
  try {
    const deployment = await Deploy.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    if (deployment.projectType === 'mern' && deployment.composeFile) {
      const workDir = path.dirname(deployment.composeFile);
      await stopDockerCompose(workDir);
    } else if (deployment.containerId) {
      await stopContainer(deployment.containerId);
    }

    deployment.status = 'stopped';
    await deployment.save();

    res.json({ message: 'Deployment stopped', deployment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop deployment' });
  }
};

exports.deleteDeployment = async (req, res) => {
  try {
    const deployment = await Deploy.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    if (deployment.projectType === 'mern' && deployment.composeFile) {
      // Remove docker-compose (containers + volumes)
      const workDir = path.dirname(deployment.composeFile);
      await removeDockerCompose(workDir, true);

      // Remove network
      if (deployment.networkName) {
        await removeNetwork(deployment.networkName);
      }
    } else {
      // Single service cleanup
      if (deployment.containerId) {
        await stopContainer(deployment.containerId);
        await removeContainer(deployment.containerId);
      }

      const imageName = `deploy-${deployment._id.toString()}`;
      await removeImage(imageName);
    }

    deployment.status = 'deleted';
    await deployment.save();

    res.json({ message: 'Deployment deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete deployment' });
  }
};

exports.restartDeployment = async (req, res) => {
  try {
    const deployment = await Deploy.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    const io = req.app.get('io');

    // If it was stopped, restart it
    if (deployment.status === 'stopped') {
      if (deployment.projectType === 'mern' && deployment.composeFile) {
        const workDir = path.dirname(deployment.composeFile);
        await runDockerCompose(deployment._id.toString(), workDir);
        const containers = await getComposeContainers(deployment._id.toString());
        await Deploy.findByIdAndUpdate(deployment._id, { containers, status: 'running' });
        log(io, deployment._id.toString(), 'success', 'MERN stack restarted');
      } else if (deployment.containerId) {
        await startContainer(deployment.containerId);
        deployment.status = 'running';
        await deployment.save();
        log(io, deployment._id.toString(), 'success', 'Container restarted');
      }
    }

    res.json({ message: 'Deployment restarted', deployment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart deployment' });
  }
};