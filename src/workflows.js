const fs = require('node:fs');
const path = require('node:path');
const { buildStudioSnapshot } = require('./studio');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

function loadWorkflows() {
  return fs
    .readdirSync(fixturesDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(fixturesDir, entry), 'utf8')))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function getWorkflowById(workflows, workflowId) {
  if (!workflowId) {
    return workflows[0] || null;
  }

  return workflows.find((workflow) => workflow.id === workflowId) || null;
}

function buildWorkflowCatalog(workflows) {
  return workflows.map((workflow) => {
    const snapshot = buildStudioSnapshot(workflow, { generatedAt: 'catalog' });
    return {
      id: workflow.id,
      name: workflow.name,
      stepCount: workflow.steps?.length || 0,
      summary: snapshot.summary
    };
  });
}

module.exports = {
  loadWorkflows,
  getWorkflowById,
  buildWorkflowCatalog
};
