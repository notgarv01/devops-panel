const generateCompose = async (deploymentId, config) => {
  const {
    serverPort,
    mongoPort,  // Dynamic port passed from deploy controller
    frontendPort,
    envVars = [],
    hasFrontend = false,
    backendDir = 'server',
    frontendDir = 'client',
    dbName,
    hasRedis = true
  } = config;

  const sanitizeName = (name) => name.replace(/-/g, '_');
  const sanitizeDir = (dir) => dir === '.' ? '.' : './' + dir;

  const envVarsString = envVars
    .filter(e => e.key !== 'PORT' && e.key !== 'MONGODB_URI' && e.key !== 'MONGO_URI')
    .map(e => '      - ' + e.key + '=' + e.value)
    .join('\n');

  const networkName = 'mern-' + deploymentId;
  const mongoVolume = 'mongo-data-' + deploymentId;
  const redisVolume = 'redis-data-' + deploymentId;
  const appContainer = 'deploy-' + deploymentId + '-app';
  const mongoContainer = 'deploy-' + deploymentId + '-mongo';
  const redisContainer = 'deploy-' + deploymentId + '-redis';
  const frontendContainer = 'deploy-' + deploymentId + '-frontend';

  const mongoSection = `  mongo:
    image: mongo:7
    container_name: ${mongoContainer}
    ports:
      - "${mongoPort}:27017"
    volumes:
      - ${mongoVolume}:/data/db
    networks:
      - ${networkName}
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped`;

  let redisSection = '';
  if (hasRedis) {
    redisSection = `
  redis:
    image: redis:7-alpine
    container_name: ${redisContainer}
    ports:
      - "6379:6379"
    volumes:
      - ${redisVolume}:/data
    networks:
      - ${networkName}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped`;
  }

  const redisEnv = hasRedis ? '      - REDIS_HOST=redis\n      - REDIS_PORT=6379\n' : '';
  const redisDepends = hasRedis ? '      redis:\n        condition: service_healthy' : '';

  const appSection = `  app:
    build:
      context: ${sanitizeDir(backendDir)}
      dockerfile: Dockerfile
    container_name: ${appContainer}
    ports:
      - "${serverPort}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - MONGODB_URI=mongodb://mongo:27017/${sanitizeName(dbName)}
${redisEnv}${envVarsString || '      - DB_NAME=' + sanitizeName(dbName)}
    depends_on:
      mongo:
        condition: service_healthy
${redisDepends}
    networks:
      - ${networkName}
    restart: unless-stopped`;

  let frontendSection = '';
  if (hasFrontend) {
    frontendSection = `
  frontend:
    build:
      context: ${sanitizeDir(frontendDir)}
      dockerfile: Dockerfile
    container_name: ${frontendContainer}
    ports:
      - "${frontendPort}:80"
    environment:
      - VITE_API_URL=http://app:3000
    depends_on:
      - app
    networks:
      - ${networkName}
    restart: unless-stopped`;
  }

  let volumesSection = `volumes:
  ${mongoVolume}:
    driver: local`;

  if (hasRedis) {
    volumesSection += '\n  ' + redisVolume + ':\n    driver: local';
  }

  const compose = `services:
${appSection}

${mongoSection}
${redisSection}
${frontendSection}

networks:
  ${networkName}:
    driver: bridge

${volumesSection}`;

  return compose;
};

const generateServerDockerfile = async (workDir, backendDir = 'server') => {
  const fs = require('fs').promises;
  const path = require('path');

  const packageJsonPath = path.join(workDir, backendDir, 'package.json');

  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};
    const hasBuild = scripts.build;

    if (hasBuild) {
      return `
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "--no-warnings", "dist/index.js"]
      `.trim();
    } else {
      return `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "--no-warnings", "src/app.js"]
      `.trim();
    }
  } catch {
    return `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "--no-warnings", "src/app.js"]
    `.trim();
  }
};

const generateFrontendDockerfile = async (workDir, frontendDir = 'client', apiUrl = 'http://localhost:5000') => {
  const fs = require('fs').promises;
  const path = require('path');

  const packageJsonPath = path.join(workDir, frontendDir, 'package.json');

  try {
    await fs.access(packageJsonPath);
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};
    const hasBuild = scripts.build;

    if (hasBuild) {
      // Create .env file with VITE_ variable for build time
      const envContent = `VITE_API_URL=${apiUrl}`;
      await fs.writeFile(path.join(workDir, frontendDir, '.env'), envContent);

      return `
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist ./usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
      `.trim();
    }
  } catch {}

  return `
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
  `.trim();
};

const generateNginxConfig = (apiUrl = 'http://app:3000') => {
  return `
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass ${apiUrl};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
  `.trim();
};

module.exports = {
  generateCompose,
  generateServerDockerfile,
  generateFrontendDockerfile,
  generateNginxConfig
};
