const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStudioSnapshot,
  explainStepBlockers,
  explainStepContext,
  buildFilteredTimeline,
  buildAgentContext,
  buildAgentPortfolioSummary,
  buildPortfolioBlockers,
  buildPortfolioHandoffs,
  buildPortfolioTimeline,
  buildHandoffQueue,
  buildDurationReport,
  buildPriorityQueue,
  buildPortfolioOverview
} = require('../src/studio');

const workflow = {
  id: 'customer-bugfix',
  name: 'Customer Bugfix Triage',
  steps: [
    {
      id: 'collect-context',
      title: 'Collect context',
      agent: 'Scout',
      status: 'completed',
      startedAt: '2026-04-15T08:00:00Z',
      finishedAt: '2026-04-15T08:05:00Z'
    },
    {
      id: 'reproduce-bug',
      title: 'Reproduce bug',
      agent: 'Debugger',
      status: 'running',
      dependsOn: ['collect-context'],
      startedAt: '2026-04-15T08:06:00Z'
    },
    {
      id: 'draft-release-notes',
      title: 'Draft release notes',
      agent: 'Writer',
      status: 'ready',
      dependsOn: ['collect-context']
    },
    {
      id: 'ship-fix',
      title: 'Ship fix',
      agent: 'Finisher',
      status: 'blocked',
      dependsOn: ['reproduce-bug'],
      notes: 'Waiting for debugger transcript.'
    }
  ]
};

test('buildStudioSnapshot summarizes workflow, agents, blockers, and ready work', () => {
  const snapshot = buildStudioSnapshot(workflow, { generatedAt: '2026-04-15T09:00:00Z' });

  assert.equal(snapshot.workflow.name, 'Customer Bugfix Triage');
  assert.deepEqual(snapshot.summary, {
    totalSteps: 4,
    completed: 1,
    running: 1,
    blocked: 1,
    ready: 1,
    idleAgents: 1
  });
  assert.equal(snapshot.blockedSteps.length, 1);
  assert.equal(snapshot.blockedSteps[0].id, 'ship-fix');
  assert.deepEqual(snapshot.graph.nodes, [
    {
      id: 'collect-context',
      title: 'Collect context',
      agent: 'Scout',
      status: 'completed',
      dependsOn: [],
      downstream: ['reproduce-bug', 'draft-release-notes'],
      openBlockers: []
    },
    {
      id: 'reproduce-bug',
      title: 'Reproduce bug',
      agent: 'Debugger',
      status: 'running',
      dependsOn: ['collect-context'],
      downstream: ['ship-fix'],
      openBlockers: []
    },
    {
      id: 'draft-release-notes',
      title: 'Draft release notes',
      agent: 'Writer',
      status: 'ready',
      dependsOn: ['collect-context'],
      downstream: [],
      openBlockers: []
    },
    {
      id: 'ship-fix',
      title: 'Ship fix',
      agent: 'Finisher',
      status: 'blocked',
      dependsOn: ['reproduce-bug'],
      downstream: [],
      openBlockers: ['reproduce-bug']
    }
  ]);
  assert.deepEqual(snapshot.graph.edges, [
    { from: 'collect-context', to: 'reproduce-bug' },
    { from: 'collect-context', to: 'draft-release-notes' },
    { from: 'reproduce-bug', to: 'ship-fix' }
  ]);
  assert.deepEqual(snapshot.readyQueue, [
    {
      id: 'draft-release-notes',
      title: 'Draft release notes',
      agent: 'Writer',
      dependsOn: ['collect-context']
    }
  ]);
  assert.deepEqual(snapshot.attentionQueue, [
    {
      id: 'reproduce-bug',
      title: 'Reproduce bug',
      agent: 'Debugger',
      status: 'running',
      blockedDependents: 1,
      readyDependents: 0
    },
    {
      id: 'ship-fix',
      title: 'Ship fix',
      agent: 'Finisher',
      status: 'blocked',
      blockedDependents: 0,
      readyDependents: 0
    }
  ]);
  assert.deepEqual(snapshot.bottleneckAgents, [
    {
      agent: 'Debugger',
      blockedSteps: 1
    }
  ]);
  assert.deepEqual(snapshot.agentLoad.map(({ agent, activeSteps }) => ({ agent, activeSteps })), [
    { agent: 'Debugger', activeSteps: 1 },
    { agent: 'Finisher', activeSteps: 0 },
    { agent: 'Scout', activeSteps: 0 },
    { agent: 'Writer', activeSteps: 1 }
  ]);
  assert.equal(snapshot.timeline[0].type, 'step.finished');
});

test('explainStepBlockers shows unmet dependencies and notes', () => {
  const explanation = explainStepBlockers(workflow, 'ship-fix');

  assert.equal(explanation.step.id, 'ship-fix');
  assert.equal(explanation.step.status, 'blocked');
  assert.deepEqual(explanation.blockers, [
    {
      id: 'reproduce-bug',
      title: 'Reproduce bug',
      status: 'running',
      agent: 'Debugger'
    }
  ]);
  assert.match(explanation.reason, /Waiting for debugger transcript/);
});

test('explainStepContext includes blockers and downstream dependents for step debugging', () => {
  const explanation = explainStepContext(workflow, 'reproduce-bug');

  assert.equal(explanation.step.id, 'reproduce-bug');
  assert.equal(explanation.blockers.length, 0);
  assert.deepEqual(explanation.downstreamDependents, [
    {
      id: 'ship-fix',
      title: 'Ship fix',
      status: 'blocked',
      agent: 'Finisher'
    }
  ]);
});

test('buildFilteredTimeline narrows activity by agent and limit', () => {
  const filtered = buildFilteredTimeline(workflow, { agent: 'Debugger', limit: 1 });

  assert.equal(filtered.filters.agent, 'Debugger');
  assert.equal(filtered.filters.limit, 1);
  assert.equal(filtered.availableAgents.includes('Debugger'), true);
  assert.equal(filtered.events.length, 1);
  assert.deepEqual(filtered.events[0], {
    type: 'step.started',
    at: '2026-04-15T08:06:00Z',
    stepId: 'reproduce-bug',
    title: 'Reproduce bug',
    agent: 'Debugger'
  });
});

test('buildAgentContext summarizes one agent across owned steps and blocked downstream impact', () => {
  const context = buildAgentContext(workflow, 'Debugger');

  assert.equal(context.agent.name, 'Debugger');
  assert.deepEqual(context.summary, {
    totalSteps: 1,
    completed: 0,
    running: 1,
    blocked: 0,
    ready: 0,
    blockedDownstreamSteps: 1
  });
  assert.deepEqual(context.steps, [
    {
      id: 'reproduce-bug',
      title: 'Reproduce bug',
      status: 'running',
      dependsOn: ['collect-context'],
      blockedBy: [],
      blocking: [
        {
          id: 'ship-fix',
          title: 'Ship fix',
          status: 'blocked',
          agent: 'Finisher'
        }
      ]
    }
  ]);
});

test('buildHandoffQueue highlights unresolved cross-agent handoffs by workflow impact', () => {
  const handoffs = buildHandoffQueue(workflow);

  assert.deepEqual(handoffs, [
    {
      from: {
        id: 'reproduce-bug',
        title: 'Reproduce bug',
        agent: 'Debugger',
        status: 'running'
      },
      to: {
        id: 'ship-fix',
        title: 'Ship fix',
        agent: 'Finisher',
        status: 'blocked'
      },
      blockedDependents: 1,
      readyDependents: 0,
      waitingSteps: 1,
      notes: 'Waiting for debugger transcript.'
    }
  ]);
});

test('buildDurationReport summarizes elapsed running work and slowest completed cycle', () => {
  const report = buildDurationReport(workflow, { generatedAt: '2026-04-15T08:16:00Z' });

  assert.equal(report.workflow.id, 'customer-bugfix');
  assert.equal(report.summary.runningStepCount, 1);
  assert.equal(report.summary.completedStepCount, 1);
  assert.equal(report.summary.longestRunningStep.id, 'reproduce-bug');
  assert.equal(report.summary.longestRunningStep.elapsedMinutes, 10);
  assert.equal(report.summary.slowestCompletedStep.id, 'collect-context');
  assert.equal(report.summary.slowestCompletedStep.cycleMinutes, 5);
  assert.deepEqual(report.runningSteps, [
    {
      id: 'reproduce-bug',
      title: 'Reproduce bug',
      agent: 'Debugger',
      status: 'running',
      elapsedMinutes: 10,
      dependsOn: ['collect-context']
    }
  ]);
});

test('buildPriorityQueue ranks the highest leverage steps by downstream impact', () => {
  const priorities = buildPriorityQueue(workflow);

  assert.deepEqual(priorities, [
    {
      id: 'reproduce-bug',
      title: 'Reproduce bug',
      agent: 'Debugger',
      status: 'running',
      directDependents: 1,
      downstreamSteps: 1,
      blockedDownstreamSteps: 1,
      readyDownstreamSteps: 0
    },
    {
      id: 'ship-fix',
      title: 'Ship fix',
      agent: 'Finisher',
      status: 'blocked',
      directDependents: 0,
      downstreamSteps: 0,
      blockedDownstreamSteps: 0,
      readyDownstreamSteps: 0
    },
    {
      id: 'draft-release-notes',
      title: 'Draft release notes',
      agent: 'Writer',
      status: 'ready',
      directDependents: 0,
      downstreamSteps: 0,
      blockedDownstreamSteps: 0,
      readyDownstreamSteps: 0
    }
  ]);
});

test('buildPortfolioOverview summarizes workflow risk, handoffs, and highest leverage next step', () => {
  const overview = buildPortfolioOverview([
    workflow,
    {
      id: 'content-launch',
      name: 'Content Launch Pipeline',
      steps: [
        {
          id: 'draft-script',
          title: 'Draft script',
          agent: 'Researcher',
          status: 'completed',
          startedAt: '2026-04-16T09:00:00Z',
          finishedAt: '2026-04-16T09:18:00Z'
        },
        {
          id: 'record-voiceover',
          title: 'Record voiceover',
          agent: 'Producer',
          status: 'running',
          dependsOn: ['draft-script'],
          startedAt: '2026-04-16T09:20:00Z'
        },
        {
          id: 'cut-teaser',
          title: 'Cut teaser clip',
          agent: 'Editor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'schedule-posts',
          title: 'Schedule launch posts',
          agent: 'Distributor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'publish-launch',
          title: 'Publish launch',
          agent: 'Operator',
          status: 'blocked',
          dependsOn: ['record-voiceover'],
          notes: 'Need the producer timeline lock before final publish.'
        }
      ]
    }
  ]);

  assert.deepEqual(overview.summary, {
    workflowCount: 2,
    blockedWorkflowCount: 2,
    runningWorkflowCount: 2,
    readyWorkflowCount: 2,
    totalHandoffs: 2
  });
  assert.equal(overview.workflows[0].id, 'content-launch');
  assert.equal(overview.workflows[0].highestLeverageStep.id, 'record-voiceover');
  assert.equal(overview.workflows[0].highestLeverageStep.blockedDownstreamSteps, 1);
  assert.equal(overview.workflows[0].handoffCount, 1);
  assert.equal(overview.workflows[1].id, 'customer-bugfix');
  assert.equal(overview.workflows[1].bottleneckAgents[0].agent, 'Debugger');
  assert.equal(overview.workflows[1].highestLeverageStep.id, 'reproduce-bug');
});


test('buildAgentPortfolioSummary rolls up cross-workflow agent load and downstream pressure', () => {
  const summary = buildAgentPortfolioSummary([
    workflow,
    {
      id: 'content-launch',
      name: 'Content Launch Pipeline',
      steps: [
        {
          id: 'draft-script',
          title: 'Draft script',
          agent: 'Researcher',
          status: 'completed',
          startedAt: '2026-04-16T09:00:00Z',
          finishedAt: '2026-04-16T09:18:00Z'
        },
        {
          id: 'record-voiceover',
          title: 'Record voiceover',
          agent: 'Producer',
          status: 'running',
          dependsOn: ['draft-script'],
          startedAt: '2026-04-16T09:20:00Z'
        },
        {
          id: 'cut-teaser',
          title: 'Cut teaser clip',
          agent: 'Editor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'schedule-posts',
          title: 'Schedule launch posts',
          agent: 'Distributor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'publish-launch',
          title: 'Publish launch',
          agent: 'Operator',
          status: 'blocked',
          dependsOn: ['record-voiceover'],
          notes: 'Need the producer timeline lock before final publish.'
        }
      ]
    }
  ]);

  assert.deepEqual(summary.summary, {
    workflowCount: 2,
    agentCount: 9,
    activeAgentCount: 5,
    totalBlockedDownstreamSteps: 2,
    totalHandoffTouches: 4
  });
  assert.equal(summary.agents[0].agent, 'Debugger');
  assert.equal(summary.agents[0].blockedDownstreamSteps, 1);
  assert.equal(summary.agents[1].agent, 'Producer');
  assert.equal(summary.agents[1].handoffTouches, 1);
  assert.equal(summary.agents[1].workflows[0].id, 'content-launch');
});

test('buildPortfolioHandoffs rolls up unresolved cross-workflow handoffs into one triage queue', () => {
  const summary = buildPortfolioHandoffs([
    workflow,
    {
      id: 'content-launch',
      name: 'Content Launch Pipeline',
      steps: [
        {
          id: 'draft-script',
          title: 'Draft script',
          agent: 'Researcher',
          status: 'completed',
          startedAt: '2026-04-16T09:00:00Z',
          finishedAt: '2026-04-16T09:18:00Z'
        },
        {
          id: 'record-voiceover',
          title: 'Record voiceover',
          agent: 'Producer',
          status: 'running',
          dependsOn: ['draft-script'],
          startedAt: '2026-04-16T09:20:00Z'
        },
        {
          id: 'cut-teaser',
          title: 'Cut teaser clip',
          agent: 'Editor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'schedule-posts',
          title: 'Schedule launch posts',
          agent: 'Distributor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'publish-launch',
          title: 'Publish launch',
          agent: 'Operator',
          status: 'blocked',
          dependsOn: ['record-voiceover'],
          notes: 'Need the producer timeline lock before final publish.'
        }
      ]
    }
  ]);

  assert.deepEqual(summary.summary, {
    workflowCount: 2,
    workflowsWithHandoffs: 2,
    totalHandoffs: 2,
    sourceAgentCount: 2,
    targetAgentCount: 2
  });
  assert.equal(summary.handoffs[0].workflow.id, 'content-launch');
  assert.equal(summary.handoffs[0].from.agent, 'Producer');
  assert.equal(summary.handoffs[0].to.agent, 'Operator');
  assert.equal(summary.handoffs[1].workflow.id, 'customer-bugfix');
  assert.equal(summary.handoffs[1].from.agent, 'Debugger');
  assert.equal(summary.handoffs[1].to.agent, 'Finisher');
});

test('buildPortfolioTimeline merges recent activity across workflows with filters', () => {
  const summary = buildPortfolioTimeline([
    workflow,
    {
      id: 'content-launch',
      name: 'Content Launch Pipeline',
      steps: [
        {
          id: 'draft-script',
          title: 'Draft script',
          agent: 'Researcher',
          status: 'completed',
          startedAt: '2026-04-16T09:00:00Z',
          finishedAt: '2026-04-16T09:18:00Z'
        },
        {
          id: 'record-voiceover',
          title: 'Record voiceover',
          agent: 'Producer',
          status: 'running',
          dependsOn: ['draft-script'],
          startedAt: '2026-04-16T09:20:00Z'
        },
        {
          id: 'publish-launch',
          title: 'Publish launch',
          agent: 'Operator',
          status: 'blocked',
          dependsOn: ['record-voiceover'],
          notes: 'Need the producer timeline lock before final publish.'
        }
      ]
    }
  ], {
    workflow: 'content-launch',
    agent: 'Producer',
    limit: 1
  });

  assert.deepEqual(summary.summary, {
    workflowCount: 2,
    eventCount: 1,
    filteredWorkflowCount: 1,
    filteredAgentCount: 1
  });
  assert.equal(summary.filters.workflow, 'content-launch');
  assert.equal(summary.filters.agent, 'Producer');
  assert.equal(summary.filters.limit, 1);
  assert.deepEqual(summary.availableWorkflows, [
    {
      id: 'content-launch',
      name: 'Content Launch Pipeline'
    },
    {
      id: 'customer-bugfix',
      name: 'Customer Bugfix Triage'
    }
  ]);
  assert.equal(summary.availableAgents.includes('Producer'), true);
  assert.equal(summary.events.length, 1);
  assert.deepEqual(summary.events[0], {
    workflow: {
      id: 'content-launch',
      name: 'Content Launch Pipeline'
    },
    type: 'step.started',
    at: '2026-04-16T09:20:00Z',
    stepId: 'record-voiceover',
    title: 'Record voiceover',
    agent: 'Producer'
  });
});

test('buildPortfolioBlockers flattens blocked-step triage across workflows', () => {
  const summary = buildPortfolioBlockers([
    workflow,
    {
      id: 'content-launch',
      name: 'Content Launch Pipeline',
      steps: [
        {
          id: 'draft-script',
          title: 'Draft script',
          agent: 'Researcher',
          status: 'completed',
          startedAt: '2026-04-16T09:00:00Z',
          finishedAt: '2026-04-16T09:18:00Z'
        },
        {
          id: 'record-voiceover',
          title: 'Record voiceover',
          agent: 'Producer',
          status: 'running',
          dependsOn: ['draft-script'],
          startedAt: '2026-04-16T09:20:00Z'
        },
        {
          id: 'cut-teaser',
          title: 'Cut teaser clip',
          agent: 'Editor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'schedule-posts',
          title: 'Schedule launch posts',
          agent: 'Distributor',
          status: 'ready',
          dependsOn: ['draft-script']
        },
        {
          id: 'publish-launch',
          title: 'Publish launch',
          agent: 'Operator',
          status: 'blocked',
          dependsOn: ['record-voiceover'],
          notes: 'Need the producer timeline lock before final publish.'
        }
      ]
    }
  ]);

  assert.deepEqual(summary.summary, {
    workflowCount: 2,
    blockedWorkflowCount: 2,
    totalBlockedSteps: 2,
    uniqueBlockerAgentCount: 2,
    totalBlockingRelationships: 2
  });
  assert.equal(summary.blockers[0].workflow.id, 'content-launch');
  assert.equal(summary.blockers[0].step.id, 'publish-launch');
  assert.deepEqual(summary.blockers[0].blockerAgents, ['Producer']);
  assert.deepEqual(summary.blockers[0].waitingOn, ['Record voiceover']);
  assert.equal(summary.blockers[0].downstreamBlockedSteps, 0);
  assert.equal(summary.blockers[0].downstreamReadySteps, 0);
  assert.match(summary.blockers[0].reason, /producer timeline lock/i);
  assert.equal(summary.blockers[1].workflow.id, 'customer-bugfix');
  assert.equal(summary.blockers[1].step.id, 'ship-fix');
  assert.deepEqual(summary.blockers[1].blockerAgents, ['Debugger']);
});
