const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');

function getResponse(server, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
  });
}

test('GET /api/snapshot returns workflow studio snapshot', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/snapshot');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.workflow.slug, 'customer-bugfix');
  assert.equal(payload.summary.totalSteps, 5);
  assert.equal(payload.summary.ready, 1);
  assert.equal(payload.graph.nodes.length, 5);
  assert.deepEqual(payload.graph.edges, [
    { from: 'collect-context', to: 'reproduce-bug' },
    { from: 'reproduce-bug', to: 'draft-release-notes' },
    { from: 'qa-signoff', to: 'ship-fix' },
    { from: 'reproduce-bug', to: 'qa-signoff' }
  ]);
  assert.equal(payload.readyQueue[0].id, 'draft-release-notes');
  assert.equal(payload.bottleneckAgents[0].agent, 'Verifier');
  assert.equal(payload.blockedSteps[0].id, 'ship-fix');
});

test('GET /api/workflows lists available local workflow fixtures', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/workflows');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.workflows.map((entry) => entry.id), ['content-launch', 'customer-bugfix']);
  assert.equal(payload.workflows[0].stepCount, 5);
  assert.equal(payload.workflows[0].summary.blocked, 1);
});

test('GET /api/snapshot can switch to another workflow fixture by query string', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/snapshot?workflow=content-launch');
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.workflow.slug, 'content-launch');
  assert.equal(payload.summary.ready, 2);
  assert.equal(payload.bottleneckAgents[0].agent, 'Producer');
});

test('GET /api/step returns blocker and downstream context for a selected step', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/step?workflow=customer-bugfix&step=qa-signoff');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.step.id, 'qa-signoff');
  assert.deepEqual(payload.downstreamDependents, [
    {
      id: 'ship-fix',
      title: 'Ship fix',
      status: 'blocked',
      agent: 'Finisher'
    }
  ]);
});

test('GET /api/timeline can filter workflow activity by agent and limit', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/timeline?workflow=content-launch&agent=Producer&limit=1');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.workflow.id, 'content-launch');
  assert.equal(payload.filters.agent, 'Producer');
  assert.equal(payload.filters.limit, 1);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].agent, 'Producer');
  assert.equal(payload.events[0].title, 'Record voiceover');
});

test('GET /api/agent returns agent focus summary and owned step impact', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/agent?workflow=content-launch&agent=Producer');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.agent.name, 'Producer');
  assert.equal(payload.summary.running, 1);
  assert.equal(payload.summary.blockedDownstreamSteps, 1);
  assert.equal(payload.steps[0].id, 'record-voiceover');
  assert.equal(payload.steps[0].blocking[0].id, 'publish-launch');
});

test('GET /api/handoffs returns unresolved agent-to-agent dependency queue', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/handoffs?workflow=content-launch');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.workflow.id, 'content-launch');
  assert.equal(payload.handoffs.length, 1);
  assert.equal(payload.handoffs[0].from.agent, 'Producer');
  assert.equal(payload.handoffs[0].to.agent, 'Operator');
  assert.equal(payload.handoffs[0].blockedDependents, 1);
  assert.equal(payload.handoffs[0].waitingSteps, 1);
});

test('GET /api/durations returns running elapsed minutes and slowest completed step', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/durations?workflow=content-launch&generatedAt=2026-04-16T09:35:00Z');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.workflow.id, 'content-launch');
  assert.equal(payload.summary.runningStepCount, 1);
  assert.equal(payload.summary.longestRunningStep.id, 'record-voiceover');
  assert.equal(payload.summary.longestRunningStep.elapsedMinutes, 15);
  assert.equal(payload.summary.slowestCompletedStep.id, 'draft-script');
  assert.equal(payload.summary.slowestCompletedStep.cycleMinutes, 18);
});

test('GET /api/priorities returns highest leverage workflow steps by downstream impact', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/priorities?workflow=content-launch');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.workflow.id, 'content-launch');
  assert.equal(payload.priorities.length, 4);
  assert.equal(payload.priorities[0].id, 'record-voiceover');
  assert.equal(payload.priorities[0].downstreamSteps, 1);
  assert.equal(payload.priorities[0].blockedDownstreamSteps, 1);
  assert.equal(payload.priorities[1].id, 'publish-launch');
  assert.equal(payload.priorities[1].readyDownstreamSteps, 0);
});

test('GET /api/portfolio returns cross-workflow overview and highest leverage next steps', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/portfolio');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.summary, {
    workflowCount: 2,
    blockedWorkflowCount: 2,
    runningWorkflowCount: 2,
    readyWorkflowCount: 2,
    totalHandoffs: 2
  });
  assert.equal(payload.workflows[0].id, 'content-launch');
  assert.equal(payload.workflows[0].highestLeverageStep.id, 'record-voiceover');
  assert.equal(payload.workflows[0].handoffCount, 1);
  assert.equal(payload.workflows[1].id, 'customer-bugfix');
  assert.equal(payload.workflows[1].highestLeverageStep.id, 'qa-signoff');
});


test('GET /api/portfolio/agents returns cross-workflow agent load rollup', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/portfolio/agents');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.summary, {
    workflowCount: 2,
    agentCount: 10,
    activeAgentCount: 5,
    totalBlockedDownstreamSteps: 2,
    totalHandoffTouches: 4
  });
  assert.equal(payload.agents[0].agent, 'Producer');
  assert.equal(payload.agents[0].activeSteps, 1);
  assert.equal(payload.agents[0].blockedDownstreamSteps, 1);
  assert.equal(payload.agents[1].agent, 'Verifier');
  assert.equal(payload.agents[1].handoffTouches, 1);
});

test('GET /api/portfolio/blockers returns cross-workflow blocked-step queue', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/portfolio/blockers');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.summary, {
    workflowCount: 2,
    blockedWorkflowCount: 2,
    totalBlockedSteps: 2,
    uniqueBlockerAgentCount: 2,
    totalBlockingRelationships: 2
  });
  assert.equal(payload.blockers[0].workflow.id, 'content-launch');
  assert.equal(payload.blockers[0].step.id, 'publish-launch');
  assert.deepEqual(payload.blockers[0].blockerAgents, ['Producer']);
  assert.equal(payload.blockers[1].workflow.id, 'customer-bugfix');
  assert.equal(payload.blockers[1].step.id, 'ship-fix');
  assert.match(payload.blockers[1].reason, /verification sign-off/i);
});

test('GET /api/portfolio/handoffs returns cross-workflow handoff triage queue', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/portfolio/handoffs');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.summary, {
    workflowCount: 2,
    workflowsWithHandoffs: 2,
    totalHandoffs: 2,
    sourceAgentCount: 2,
    targetAgentCount: 2
  });
  assert.equal(payload.handoffs[0].workflow.id, 'content-launch');
  assert.equal(payload.handoffs[0].from.agent, 'Producer');
  assert.equal(payload.handoffs[0].to.agent, 'Operator');
  assert.equal(payload.handoffs[1].workflow.id, 'customer-bugfix');
  assert.equal(payload.handoffs[1].from.agent, 'Verifier');
  assert.equal(payload.handoffs[1].to.agent, 'Finisher');
});

test('GET /api/portfolio/timeline returns cross-workflow recent activity with workflow and agent filters', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/portfolio/timeline?workflow=content-launch&agent=Producer&limit=1');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.summary, {
    workflowCount: 2,
    eventCount: 1,
    filteredWorkflowCount: 1,
    filteredAgentCount: 1
  });
  assert.equal(payload.filters.workflow, 'content-launch');
  assert.equal(payload.filters.agent, 'Producer');
  assert.equal(payload.filters.limit, 1);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].workflow.id, 'content-launch');
  assert.equal(payload.events[0].title, 'Record voiceover');
  assert.equal(payload.events[0].agent, 'Producer');
});

test('GET / renders workflow portfolio overview for cross-workflow triage', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/?workflow=content-launch&step=record-voiceover&agent=Producer&limit=2');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(response.body, /Workflow catalog/i);
  assert.match(response.body, /Workflow portfolio/i);
  assert.match(response.body, /Portfolio agent load/i);
  assert.match(response.body, /Portfolio blocker queue/i);
  assert.match(response.body, /Blocked workflows/i);
  assert.match(response.body, /Total blocked steps/i);
  assert.match(response.body, /Portfolio timeline/i);
  assert.match(response.body, /Cross-workflow activity/i);
  assert.match(response.body, /Content Launch Pipeline/);
  assert.match(response.body, /Record voiceover/);
  assert.match(response.body, /Portfolio handoff queue/i);
  assert.match(response.body, /Portfolio agents/i);
  assert.match(response.body, /Portfolio workflows/i);
  assert.match(response.body, /Workflows with handoffs/i);
  assert.match(response.body, /Cross-workflow handoffs/i);
  assert.match(response.body, /blocked downstream/i);
  assert.match(response.body, /Content Launch Pipeline/);
  assert.match(response.body, /selected/);
  assert.match(response.body, /Ready next/i);
  assert.match(response.body, /Cut teaser clip/);
  assert.match(response.body, /Step inspector/i);
  assert.match(response.body, /Workflow graph/i);
  assert.match(response.body, /Dependencies/i);
  assert.match(response.body, /record-voiceover/);
  assert.match(response.body, /publish-launch/);
  assert.match(response.body, /Open blockers: none/);
  assert.match(response.body, /Recent activity/i);
  assert.match(response.body, /Filter timeline by agent/i);
  assert.match(response.body, /Producer/);
  assert.match(response.body, /Limit events/i);
  assert.match(response.body, /Attention queue/i);
  assert.match(response.body, /1 blocked dependent/);
  assert.match(response.body, /Agent focus/i);
  assert.match(response.body, /Blocked downstream steps/i);
  assert.match(response.body, /Agent handoffs/i);
  assert.match(response.body, /Producer → Operator/);
  assert.match(response.body, /Timing insights/i);
  assert.match(response.body, /Longest running step/i);
  assert.match(response.body, /Slowest completed step/i);
  assert.match(response.body, /Highest leverage steps/i);
  assert.match(response.body, /Downstream impact/i);
});

test('GET /api/snapshot returns 404 for unknown workflow ids', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());

  const response = await getResponse(server, '/api/snapshot?workflow=missing-workflow');
  assert.equal(response.statusCode, 404);
  const payload = JSON.parse(response.body);
  assert.match(payload.error, /Unknown workflow/);
});
