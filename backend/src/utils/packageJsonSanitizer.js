/**
 * Fix AI surgery mistakes where dependency keys include version suffixes,
 * e.g. "express@^4.17.1": "^5.2.1" → "express": "^5.2.1"
 */
function sanitizePackageJsonDependencyKeys(content) {
  try {
    const pkg = JSON.parse(content);
    if (!pkg.dependencies && !pkg.devDependencies) return content;

    for (const section of ['dependencies', 'devDependencies']) {
      if (!pkg[section]) continue;
      const cleaned = {};
      for (const [key, value] of Object.entries(pkg[section])) {
        const match = key.match(/^(@[^@/]+\/[^@]+|[^@]+)@\^?[\d.]+(?:[-\w.]*)?$/);
        const cleanKey = match ? match[1] : key;
        cleaned[cleanKey] = value;
      }
      pkg[section] = cleaned;
    }

    return JSON.stringify(pkg, null, 2) + '\n';
  } catch {
    return content;
  }
}

module.exports = { sanitizePackageJsonDependencyKeys };
