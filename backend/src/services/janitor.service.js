const simpleGit = require('simple-git');
const { createGitHubService } = require('./github.service');
const Project = require('../models/Project');

// Branch age threshold in days
const BRANCH_AGE_THRESHOLD_DAYS = 7;

// Statuses that indicate branch can be deleted
const DELETABLE_STATUSES = ['ready', 'failed', 'error'];

// Janitor service for automated branch cleanup
class JanitorService {
  constructor(githubToken) {
    this.github = createGitHubService(githubToken);
  }

  // Main cleanup job
  async runCleanup() {
    console.log('[Janitor] Starting branch cleanup...');

    try {
      // Get all projects
      const projects = await Project.find({}).lean();

      const results = {
        checked: 0,
        deleted: 0,
        skipped: 0,
        errors: []
      };

      for (const project of projects) {
        if (!project.githubUrl || !project.targetBranch) {
          continue;
        }

        try {
          const result = await this.checkAndPruneBranch(project);
          results.checked++;

          if (result.deleted) {
            results.deleted++;
            console.log(`[Janitor] Deleted ${project.targetBranch} from ${project.name}`);
          } else if (result.skipped) {
            results.skipped++;
          }
        } catch (error) {
          results.errors.push({
            project: project.name,
            error: error.message
          });
        }
      }

      console.log(`[Janitor] Cleanup complete: ${results.deleted} deleted, ${results.skipped} skipped, ${results.errors.length} errors`);
      return results;

    } catch (error) {
      console.error('[Janitor] Cleanup failed:', error);
      throw error;
    }
  }

  // Check if a project's deployment branch should be pruned
  async checkAndPruneBranch(project) {
    const { name, githubUrl, targetBranch, status, lastDeployAt } = project;

    // Skip if no target branch
    if (!targetBranch || !targetBranch.startsWith('devops-deploy-')) {
      return { skipped: true, reason: 'not-auto-branch' };
    }

    // Check branch age
    const branchAge = this.getBranchAge(lastDeployAt);
    if (branchAge < BRANCH_AGE_THRESHOLD_DAYS) {
      return { skipped: true, reason: 'too-recent', age: branchAge };
    }

    // Check if deployment is in a clean state
    if (!DELETABLE_STATUSES.includes(status?.toLowerCase())) {
      return { skipped: true, reason: 'deployment-active' };
    }

    // Parse GitHub URL to get owner/repo
    const match = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
    if (!match) {
      return { skipped: true, reason: 'invalid-url' };
    }

    const [, owner, repo] = match;
    const repoName = repo.replace('.git', '');

    // Check if branch still exists
    try {
      const branchExists = await this.github.getBranch(owner, repoName, targetBranch);

      if (!branchExists) {
        // Branch already deleted, just update project
        await Project.updateOne(
          { name },
          { $unset: { targetBranch: 1 } }
        );
        return { deleted: true, reason: 'already-deleted' };
      }

      // Delete the branch
      await this.github.deleteBranch(owner, repoName, targetBranch);

      // Update project to remove branch reference
      await Project.updateOne(
        { name },
        { $unset: { targetBranch: 1, lastDeployAt: 1 } }
      );

      return { deleted: true, reason: 'pruned' };

    } catch (error) {
      if (error.status === 404) {
        return { skipped: true, reason: 'branch-not-found' };
      }
      throw error;
    }
  }

  // Calculate branch age in days
  getBranchAge(lastDeployAt) {
    if (!lastDeployAt) return 999;
    const ageMs = Date.now() - new Date(lastDeployAt).getTime();
    return ageMs / (1000 * 60 * 60 * 24);
  }

  // Get list of pruned branches (for reporting)
  async getPrunedBranches() {
    const projects = await Project.find({
      targetBranch: { $exists: true, $ne: null }
    }).lean();

    return projects
      .filter(p => p.targetBranch?.startsWith('devops-deploy-'))
      .map(p => ({
        project: p.name,
        branch: p.targetBranch,
        age: Math.round(this.getBranchAge(p.lastDeployAt)),
        status: p.status
      }));
  }
}

// Schedule the janitor to run periodically
let janitorInterval = null;

const startJanitor = (githubToken, intervalHours = 24) => {
  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Run immediately on startup
  runJanitorNow(githubToken);

  // Then schedule periodic runs
  janitorInterval = setInterval(() => {
    runJanitorNow(githubToken);
  }, intervalMs);

  console.log(`[Janitor] Started with ${intervalHours}h interval`);
};

const runJanitorNow = async (githubToken) => {
  try {
    const janitor = new JanitorService(githubToken);
    const results = await janitor.runCleanup();
    console.log(`[Janitor] Last run: ${results.deleted} pruned, ${results.skipped} skipped`);
  } catch (error) {
    console.error('[Janitor] Run failed:', error.message);
  }
};

const stopJanitor = () => {
  if (janitorInterval) {
    clearInterval(janitorInterval);
    janitorInterval = null;
    console.log('[Janitor] Stopped');
  }
};

// Manual trigger endpoint
const triggerJanitor = async (githubToken) => {
  const janitor = new JanitorService(githubToken);
  return janitor.runCleanup();
};

module.exports = {
  JanitorService,
  startJanitor,
  stopJanitor,
  triggerJanitor
};