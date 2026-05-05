const fs = require('fs').promises;
const path = require('path');
const git = require('isomorphic-git');

class GitService {
  constructor() {
    this.defaultAuthor = {
      name: 'DevOps Panel',
      email: 'panel@devops.local'
    };
  }

  async initRepo(workDir, options = {}) {
    await git.init({
      fs,
      dir: workDir,
      ...options
    });
    return { success: true, dir: workDir };
  }

  async addFile(workDir, filePath, options = {}) {
    const filepath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
    await git.add({ fs, dir: workDir, filepath: path.relative(workDir, filepath) });
    return { success: true, file: filePath };
  }

  async addAll(workDir) {
    await git.add({ fs, dir: workDir, filepath: '.' });
    return { success: true };
  }

  async commit(workDir, message, author = null) {
    const commit = await git.commit({
      fs,
      dir: workDir,
      message,
      author: author || this.defaultAuthor
    });
    return { success: true, sha: commit };
  }

  async createInitialCommit(workDir, files = [], message = 'Initial commit from DevOps Panel') {
    // Add all files
    await this.addAll(workDir);

    // Commit
    const commit = await this.commit(workDir, message);
    return commit;
  }

  async getStatus(workDir) {
    const matrix = await git.statusMatrix({ fs, dir: workDir });
    return matrix.map(([filepath, head, workdir, stage]) => ({
      filepath,
      head: head === 1,
      workdir: workdir === 2,
      stage: stage === 3,
      dirty: head !== workdir || workdir !== stage
    }));
  }

  async getLog(workDir, depth = 10) {
    const commits = await git.log({ fs, dir: workDir, depth });
    return commits.map(c => ({
      oid: c.oid,
      message: c.commit.message,
      author: c.commit.author,
      timestamp: c.commit.author.timestamp
    }));
  }

  async getCurrentBranch(workDir) {
    try {
      const branch = await git.currentBranch({ fs, dir: workDir });
      return branch;
    } catch {
      return null;
    }
  }

  async listBranches(workDir) {
    const branches = await git.listBranches({ fs, dir: workDir });
    return branches;
  }

  async createBranch(workDir, branch) {
    await git.branch({ fs, dir: workDir, ref: branch });
    return { success: true, branch };
  }

  async checkout(workDir, ref, options = {}) {
    await git.checkout({ fs, dir: workDir, ref, ...options });
    return { success: true, ref };
  }
}

class GitHubPushService {
  constructor(token) {
    this.token = token;
    this.git = new GitService();
  }

  async pushToGithub(workDir, remoteUrl, options = {}) {
    const {
      branch = 'main',
      author = null,
      force = false,
      message = 'Update from DevOps Panel'
    } = options;

    const authUrl = this.authenticateUrl(remoteUrl);

    try {
      const status = await this.git.getStatus(workDir);
      const hasChanges = status.some(s => s.dirty || !s.head);

      if (!hasChanges && !force) {
        return {
          success: true,
          message: 'No changes to commit',
          branch
        };
      }

      // Check if repo is initialized
      let currentBranch;
      try {
        currentBranch = await this.git.getCurrentBranch(workDir);
      } catch {
        // Not a git repo, initialize
        await this.git.initRepo(workDir);
        currentBranch = branch;
      }

      // Create branch if needed
      if (currentBranch !== branch) {
        await this.git.createBranch(workDir, branch);
      }

      // Add all files
      await this.git.addAll(workDir);

      // Check what to commit
      const newStatus = await this.git.getStatus(workDir);
      const toCommit = newStatus.filter(s => s.dirty || (!s.head && s.workdir));

      if (toCommit.length > 0) {
        await this.git.commit(workDir, message, author);
      }

      // Push
      await git.push({
        fs,
        http: {
          request: async (opts) => {
            const url = opts.url.href;
            const response = await fetch(url, {
              method: opts.method,
              headers: {
                ...opts.headers,
                'Authorization': `Bearer ${this.token}`
              },
              body: opts.body
            });
            return {
              url: response.url,
              status: response.status,
              headers: response.headers,
              text: () => response.text()
            };
          }
        },
        dir: workDir,
        ref: branch,
        remote: 'origin',
        force
      });

      return {
        success: true,
        branch,
        message: `Pushed to ${branch}`,
        filesUpdated: toCommit.length
      };

    } catch (error) {
      console.error('[GitHubPush] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  authenticateUrl(remoteUrl) {
    // Add token to URL for authentication
    const url = new URL(remoteUrl);
    url.username = 'x-access-token';
    url.password = this.token;
    return url.toString();
  }

  async cloneAndPush(sourceDir, remoteUrl, targetBranch = 'main', options = {}) {
    const { message = 'Sync from DevOps Panel', author = null } = options;

    // Get a temp directory for the clone
    const workDir = sourceDir; // Use the same directory, assume already cloned

    // Push the existing repo
    return this.pushToGithub(workDir, remoteUrl, {
      branch: targetBranch,
      message,
      author
    });
  }
}

const createGitService = () => new GitService();
const createGitHubPushService = (token) => new GitHubPushService(token);

module.exports = {
  GitService,
  GitHubPushService,
  createGitService,
  createGitHubPushService
};