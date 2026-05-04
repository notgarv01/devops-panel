const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/devops-panel').then(async () => {
  const Deploy = require('./src/models/Deploy');

  // Get all deployments
  const deployments = await Deploy.find({});
  console.log('Found deployments:', deployments.length);

  for (const dep of deployments) {
    console.log(`- ${dep.projectName} (${dep._id}): status=${dep.status}`);
  }

  // Update the most recent one to error status so user can delete it
  const latest = await Deploy.findOne({}).sort({ createdAt: -1 });
  if (latest) {
    await Deploy.findByIdAndUpdate(latest._id, { status: 'error', containers: [] });
    console.log(`\nUpdated ${latest._id} (${latest.projectName}) to 'error' status`);
    console.log('Delete this deployment and redeploy with the fixed Dockerfile');
  }

  process.exit();
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});