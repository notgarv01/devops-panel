const fs = require('fs-extra');
const path = require('path');

/**
 * ExecuteMigration - The Atomic Mover
 * Performs physical file surgery based on AI's Migration Blueprint
 */
async function executeMigration(workDir, moves, logs) {
  const results = {
    moved: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  if (!moves || moves.length === 0) {
    logs?.emit('info', '[AtomicMover] No moves to execute');
    return results;
  }

  logs?.emit('info', `[AtomicMover] Executing ${moves.length} atomic moves...`);

  // Sort moves: deepest files first to avoid moving parent folders before children
  const sortedMoves = [...moves].sort((a, b) =>
    b.from.split('/').length - a.from.split('/').length
  );

  for (const task of sortedMoves) {
    const oldPath = path.join(workDir, task.from);
    const newPath = path.join(workDir, task.to);

    try {
      const exists = await fs.pathExists(oldPath);

      if (!exists) {
        logs?.emit('warning', `[AtomicMover] Skip: ${task.from} not found`);
        results.skipped++;
        continue;
      }

      // Ensure destination directory exists
      await fs.ensureDir(path.dirname(newPath));

      // Atomic move - overwrite if exists
      await fs.move(oldPath, newPath, { overwrite: true });

      logs?.emit('info', `  ✓ ${task.from} → ${task.to}`);
      results.moved++;
    } catch (err) {
      console.error(`[AtomicMover] Error moving ${task.from}:`, err.message);
      logs?.emit('error', `  ✗ ${task.from}: ${err.message}`);
      results.failed++;
      results.errors.push(`${task.from}: ${err.message}`);
    }
  }

  console.log(`[AtomicMover] Complete: ${results.moved} moved, ${results.skipped} skipped, ${results.failed} failed`);
  return results;
}

/**
 * Cleanup empty directories left behind after migration
 * Keeps repo clean for Vercel
 */
async function cleanupEmptyDirs(workDir, excludeDirs = ['node_modules', '.git']) {
  const removeEmptyDirs = async (dir, depth = 0) => {
    if (depth > 10) return;
    if (excludeDirs.some(ex => dir.includes(ex))) return;

    try {
      const entries = await fs.readdir(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          await removeEmptyDirs(fullPath, depth + 1);

          // Check if directory is now empty
          const remaining = await fs.readdir(fullPath);
          if (remaining.length === 0) {
            await fs.remove(fullPath);
            console.log(`[AtomicMover] Cleaned empty dir: ${path.relative(workDir, fullPath)}`);
          }
        }
      }
    } catch {}
  };

  await removeEmptyDirs(workDir);
}

/**
 * Verify migration result - check that all expected files exist at new locations
 */
async function verifyMigration(workDir, moves) {
  const verification = {
    valid: true,
    missing: [],
    found: []
  };

  for (const task of moves) {
    const newPath = path.join(workDir, task.to);
    const exists = await fs.pathExists(newPath);

    if (exists) {
      verification.found.push(task.to);
    } else {
      verification.missing.push(task.to);
      verification.valid = false;
    }
  }

  return verification;
}

module.exports = {
  executeMigration,
  cleanupEmptyDirs,
  verifyMigration
};