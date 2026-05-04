# DevOps Deployment Panel

A Vercel-like platform for one-click deployments using GitHub repositories, Docker, and the MERN stack.

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- MongoDB (or use Docker Compose to spin it up)

### Development Setup

```bash
# Clone and enter directory
cd devops-panel

# Install dependencies
npm install

# Start with Docker Compose (recommended)
docker-compose up --build

# Or run locally:
# Terminal 1: Start MongoDB
# Terminal 2: npm run dev:backend
# Terminal 3: npm run dev:frontend
```

### Access Points
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5000
- **MongoDB**: localhost:27017

## Project Structure

```
devops-panel/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   └── deploy.controller.js   # Deployment logic
│   │   ├── models/
│   │   │   └── Deploy.js              # MongoDB schema
│   │   ├── routes/
│   │   │   └── deploy.routes.js       # API routes
│   │   ├── socket/
│   │   │   └── socketHandler.js       # Real-time logs
│   │   ├── utils/
│   │   │   └── dockerOperations.js    # Docker CLI wrapper
│   │   └── index.js                   # Express server
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   │   ├── NewProjectForm.jsx
│   │   │   ├── DeploymentList.jsx
│   │   │   └── LogsTerminal.jsx
│   │   ├── services/
│   │   │   ├── api.js
│   │   │   └── socket.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
├── docker-compose.yml
└── package.json
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/deploy` | Start new deployment |
| GET | `/api/deploy` | List all deployments |
| GET | `/api/deploy/:id` | Get deployment details |
| POST | `/api/deploy/:id/stop` | Stop deployment |
| DELETE | `/api/deploy/:id` | Delete deployment |
| POST | `/api/deploy/:id/restart` | Restart deployment |

## Deployment Flow

1. **Clone** - Git clone repository to `/tmp/deploys/{id}`
2. **Detect** - Auto-detect project type (React, Node, static)
3. **Build** - Generate Dockerfile and build image
4. **Run** - Start container on dynamic port (30000-60000)
5. **Track** - Stream logs via Socket.io, store metadata in MongoDB

## Environment Variables

Backend (`backend/.env`):
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/devops-panel
FRONTEND_URL=http://localhost:5173
```

Frontend (`frontend/.env`):
```
VITE_API_URL=http://localhost:5000
```

## Socket.io Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-deployment` | Client → Server | Subscribe to logs |
| `leave-deployment` | Client → Server | Unsubscribe |
| `deployment-log` | Server → Client | Log entry |
| `deployment-status` | Server → Client | Status change |

## Hackathon Tips

1. **Windows Users**: Ensure Docker Desktop is running with Linux containers
2. **Port Conflicts**: Check no other services on ports 5000, 5173, 27017
3. **GitHub Rate Limits**: Use personal access token for private repos
4. **Container Cleanup**: Old containers auto-clean every 30 minutes