function normalizeDependsOn(step) {
  return Array.isArray(step.dependsOn) ? step.dependsOn : [];
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toWholeMinutes(startAt, endAt) {
  const startTimestamp = toTimestamp(startAt);
  const endTimestamp = toTimestamp(endAt);
  if (startTimestamp === null || endTimestamp === null || endTimestamp < startTimestamp) {
    return null;
  }
  return Math.round((endTimestamp - startTimestamp) / 60000);
}

function buildTimeline(steps) {
  const priority = {
    'step.finished': 0,
    'step.started': 1
  };

  return steps
    .flatMap((step) => {
      const events = [];
      if (step.finishedAt) {
        events.push({
          type: 'step.finished',
          at: step.finishedAt,
          stepId: step.id,
          title: step.title,
          agent: step.agent
        });
      }
      if (step.startedAt) {
        events.push({
          type: 'step.started',
          at: step.startedAt,
          stepId: step.id,
          title: step.title,
          agent: step.agent
        });
      }
      return events;
    })
    .sort((left, right) => {
      const byType = priority[left.type] - priority[right.type];
      if (byType !== 0) {
        return byType;
      }
      return String(right.at).localeCompare(String(left.at));
    });
}

function buildAgentLoad(steps) {
  const byAgent = new Map();
  for (const step of steps) {
    if (!byAgent.has(step.agent)) {
      byAgent.set(step.agent, { agent: step.agent, activeSteps: 0, blockedSteps: 0, completedSteps: 0 });
    }
    const bucket = byAgent.get(step.agent);
    if (step.status === 'running' || step.status === 'ready') {
      bucket.activeSteps += 1;
    }
    if (step.status === 'blocked') {
      bucket.blockedSteps += 1;
    }
    if (step.status === 'completed') {
      bucket.completedSteps += 1;
    }
  }

  return [...byAgent.values()].sort((left, right) => left.agent.localeCompare(right.agent));
}

function buildReadyQueue(steps) {
  return steps
    .filter((step) => step.status === 'ready')
    .map((step) => ({
      id: step.id,
      title: step.title,
      agent: step.agent,
      dependsOn: normalizeDependsOn(step)
    }));
}

function buildAttentionQueue(steps) {
  const statusPriority = {
    running: 0,
    blocked: 1
  };

  return steps
    .filter((step) => step.status === 'running' || step.status === 'blocked')
    .map((step) => {
      const dependents = steps.filter((candidate) => normalizeDependsOn(candidate).includes(step.id));
      return {
        id: step.id,
        title: step.title,
        agent: step.agent,
        status: step.status,
        blockedDependents: dependents.filter((candidate) => candidate.status === 'blocked').length,
        readyDependents: dependents.filter((candidate) => candidate.status === 'ready').length
      };
    })
    .sort((left, right) => {
      if (right.blockedDependents !== left.blockedDependents) {
        return right.blockedDependents - left.blockedDependents;
      }
      if (right.readyDependents !== left.readyDependents) {
        return right.readyDependents - left.readyDependents;
      }
      if ((statusPriority[left.status] || 99) !== (statusPriority[right.status] || 99)) {
        return (statusPriority[left.status] || 99) - (statusPriority[right.status] || 99);
      }
      return left.title.localeCompare(right.title);
    });
}

function buildBottleneckAgents(blockedSteps) {
  const counts = new Map();

  for (const blockedStep of blockedSteps) {
    for (const blocker of blockedStep.blockers) {
      const key = blocker.agent || blocker.title;
      counts.set(key, {
        agent: blocker.agent || blocker.title,
        blockedSteps: (counts.get(key)?.blockedSteps || 0) + 1
      });
    }
  }

  return [...counts.values()].sort((left, right) => {
    if (right.blockedSteps !== left.blockedSteps) {
      return right.blockedSteps - left.blockedSteps;
    }
    return left.agent.localeCompare(right.agent);
  });
}

function buildHandoffQueue(workflow) {
  const steps = workflow.steps || [];

  return steps
    .flatMap((step) => {
      const context = explainStepContext(workflow, step.id);
      return context.blockers.map((blocker) => {
        const dependents = steps.filter((candidate) => normalizeDependsOn(candidate).includes(blocker.id));
        return {
          from: {
            id: blocker.id,
            title: blocker.title,
            agent: blocker.agent,
            status: blocker.status
          },
          to: {
            id: step.id,
            title: step.title,
            agent: step.agent,
            status: step.status
          },
          blockedDependents: dependents.filter((candidate) => candidate.status === 'blocked').length,
          readyDependents: dependents.filter((candidate) => candidate.status === 'ready').length,
          waitingSteps: dependents.filter((candidate) => candidate.status === 'blocked' || candidate.status === 'ready').length,
          notes: step.notes || ''
        };
      });
    })
    .sort((left, right) => {
      if (right.blockedDependents !== left.blockedDependents) {
        return right.blockedDependents - left.blockedDependents;
      }
      if (right.waitingSteps !== left.waitingSteps) {
        return right.waitingSteps - left.waitingSteps;
      }
      return left.from.title.localeCompare(right.from.title);
    });
}

function explainStepBlockers(workflow, stepId) {
  const steps = workflow.steps || [];
  const lookup = new Map(steps.map((step) => [step.id, step]));
  const step = lookup.get(stepId);
  if (!step) {
    throw new Error(`Unknown step: ${stepId}`);
  }

  const blockers = normalizeDependsOn(step)
    .map((dependencyId) => lookup.get(dependencyId))
    .filter(Boolean)
    .filter((dependency) => dependency.status !== 'completed')
    .map((dependency) => ({
      id: dependency.id,
      title: dependency.title,
      status: dependency.status,
      agent: dependency.agent
    }));

  const reasonParts = [];
  if (blockers.length > 0) {
    reasonParts.push(`Waiting on ${blockers.map((blocker) => blocker.title).join(', ')}.`);
  }
  if (step.notes) {
    reasonParts.push(step.notes);
  }

  return {
    step: {
      id: step.id,
      title: step.title,
      status: step.status,
      agent: step.agent
    },
    blockers,
    reason: reasonParts.join(' ')
  };
}

function explainStepContext(workflow, stepId) {
  const steps = workflow.steps || [];
  const lookup = new Map(steps.map((step) => [step.id, step]));
  const step = lookup.get(stepId);
  if (!step) {
    throw new Error(`Unknown step: ${stepId}`);
  }

  const blockers = normalizeDependsOn(step)
    .map((dependencyId) => lookup.get(dependencyId))
    .filter(Boolean)
    .filter((dependency) => dependency.status !== 'completed')
    .map((dependency) => ({
      id: dependency.id,
      title: dependency.title,
      status: dependency.status,
      agent: dependency.agent
    }));

  const downstreamDependents = steps
    .filter((candidate) => normalizeDependsOn(candidate).includes(step.id))
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      status: candidate.status,
      agent: candidate.agent
    }));

  return {
    step: {
      id: step.id,
      title: step.title,
      status: step.status,
      agent: step.agent,
      dependsOn: normalizeDependsOn(step),
      notes: step.notes || ''
    },
    blockers,
    downstreamDependents
  };
}

function buildWorkflowGraph(workflow) {
  const steps = workflow.steps || [];
  const lookup = new Map(steps.map((step) => [step.id, step]));
  const dependentsByStep = new Map(steps.map((step) => [step.id, []]));

  for (const step of steps) {
    for (const dependencyId of normalizeDependsOn(step)) {
      if (dependentsByStep.has(dependencyId)) {
        dependentsByStep.get(dependencyId).push(step.id);
      }
    }
  }

  const nodes = steps.map((step) => {
    const openBlockers = normalizeDependsOn(step)
      .map((dependencyId) => lookup.get(dependencyId))
      .filter(Boolean)
      .filter((dependency) => dependency.status !== 'completed')
      .map((dependency) => dependency.id);

    return {
      id: step.id,
      title: step.title,
      agent: step.agent,
      status: step.status,
      dependsOn: normalizeDependsOn(step),
      downstream: dependentsByStep.get(step.id) || [],
      openBlockers
    };
  });

  const edges = steps.flatMap((step) => normalizeDependsOn(step).map((dependencyId) => ({
    from: dependencyId,
    to: step.id
  })));

  return {
    nodes,
    edges
  };
}

function buildStudioSnapshot(workflow, options = {}) {
  const steps = workflow.steps || [];
  const agentLoad = buildAgentLoad(steps);
  const blockedSteps = steps
    .filter((step) => step.status === 'blocked')
    .map((step) => ({
      id: step.id,
      title: step.title,
      agent: step.agent,
      ...explainStepBlockers(workflow, step.id)
    }));
  const readyQueue = buildReadyQueue(steps);
  const bottleneckAgents = buildBottleneckAgents(blockedSteps);
  const attentionQueue = buildAttentionQueue(steps);
  const handoffQueue = buildHandoffQueue(workflow);

  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    workflow: {
      id: workflow.id,
      slug: workflow.id,
      name: workflow.name
    },
    summary: {
      totalSteps: steps.length,
      completed: steps.filter((step) => step.status === 'completed').length,
      running: steps.filter((step) => step.status === 'running').length,
      blocked: blockedSteps.length,
      ready: readyQueue.length,
      idleAgents: agentLoad.filter((entry) => entry.activeSteps === 0 && entry.blockedSteps === 0).length
    },
    graph: buildWorkflowGraph(workflow),
    agentLoad,
    blockedSteps,
    readyQueue,
    bottleneckAgents,
    attentionQueue,
    handoffQueue,
    timeline: buildTimeline(steps)
  };
}

function buildFilteredTimeline(workflow, options = {}) {
  const snapshot = buildStudioSnapshot(workflow, { generatedAt: options.generatedAt || 'timeline' });
  const availableAgents = [...new Set(snapshot.timeline.map((event) => event.agent).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const limitValue = Number.parseInt(String(options.limit || ''), 10);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 5;
  const agent = options.agent && availableAgents.includes(options.agent) ? options.agent : '';
  const events = snapshot.timeline
    .filter((event) => !agent || event.agent === agent)
    .slice(0, limit);

  return {
    workflow: snapshot.workflow,
    filters: {
      agent,
      limit
    },
    availableAgents,
    events
  };
}

function buildAgentContext(workflow, agentName) {
  const steps = workflow.steps || [];
  const agent = steps.find((step) => step.agent === agentName)?.agent || '';
  const ownedSteps = steps.filter((step) => step.agent === agent);

  return {
    agent: {
      name: agent
    },
    summary: {
      totalSteps: ownedSteps.length,
      completed: ownedSteps.filter((step) => step.status === 'completed').length,
      running: ownedSteps.filter((step) => step.status === 'running').length,
      blocked: ownedSteps.filter((step) => step.status === 'blocked').length,
      ready: ownedSteps.filter((step) => step.status === 'ready').length,
      blockedDownstreamSteps: ownedSteps.reduce((count, step) => (
        count + steps.filter((candidate) => normalizeDependsOn(candidate).includes(step.id) && candidate.status === 'blocked').length
      ), 0)
    },
    steps: ownedSteps.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      dependsOn: normalizeDependsOn(step),
      blockedBy: explainStepContext(workflow, step.id).blockers,
      blocking: steps
        .filter((candidate) => normalizeDependsOn(candidate).includes(step.id) && candidate.status === 'blocked')
        .map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          status: candidate.status,
          agent: candidate.agent
        }))
    }))
  };
}

function buildPriorityQueue(workflow) {
  const steps = workflow.steps || [];
  const directDependents = new Map(steps.map((step) => [step.id, []]));
  for (const step of steps) {
    for (const dependencyId of normalizeDependsOn(step)) {
      if (directDependents.has(dependencyId)) {
        directDependents.get(dependencyId).push(step);
      }
    }
  }

  function collectDownstream(stepId, seen = new Set()) {
    const dependents = directDependents.get(stepId) || [];
    const downstream = [];
    for (const dependent of dependents) {
      if (seen.has(dependent.id)) {
        continue;
      }
      seen.add(dependent.id);
      downstream.push(dependent);
      downstream.push(...collectDownstream(dependent.id, seen));
    }
    return downstream;
  }

  const statusPriority = {
    running: 0,
    blocked: 1,
    ready: 2,
    completed: 3
  };

  return steps
    .filter((step) => step.status !== 'completed')
    .map((step) => {
      const downstream = collectDownstream(step.id);
      return {
        id: step.id,
        title: step.title,
        agent: step.agent,
        status: step.status,
        directDependents: (directDependents.get(step.id) || []).length,
        downstreamSteps: downstream.length,
        blockedDownstreamSteps: downstream.filter((candidate) => candidate.status === 'blocked').length,
        readyDownstreamSteps: downstream.filter((candidate) => candidate.status === 'ready').length
      };
    })
    .sort((left, right) => {
      if (right.downstreamSteps !== left.downstreamSteps) {
        return right.downstreamSteps - left.downstreamSteps;
      }
      if (right.blockedDownstreamSteps !== left.blockedDownstreamSteps) {
        return right.blockedDownstreamSteps - left.blockedDownstreamSteps;
      }
      if ((statusPriority[left.status] || 99) !== (statusPriority[right.status] || 99)) {
        return (statusPriority[left.status] || 99) - (statusPriority[right.status] || 99);
      }
      return left.title.localeCompare(right.title);
    });
}

function buildPortfolioOverview(workflows) {
  const normalizedWorkflows = Array.isArray(workflows) ? workflows : [];
  const workflowRows = normalizedWorkflows
    .map((workflow) => {
      const snapshot = buildStudioSnapshot(workflow, { generatedAt: 'portfolio' });
      const handoffs = buildHandoffQueue(workflow);
      const priorities = buildPriorityQueue(workflow);
      return {
        id: workflow.id,
        name: workflow.name,
        summary: snapshot.summary,
        blockedStepCount: snapshot.blockedSteps.length,
        handoffCount: handoffs.length,
        bottleneckAgents: snapshot.bottleneckAgents,
        highestLeverageStep: priorities[0] || null
      };
    })
    .sort((left, right) => {
      if (right.blockedStepCount !== left.blockedStepCount) {
        return right.blockedStepCount - left.blockedStepCount;
      }
      if (right.summary.running !== left.summary.running) {
        return right.summary.running - left.summary.running;
      }
      if (right.summary.ready !== left.summary.ready) {
        return right.summary.ready - left.summary.ready;
      }
      return left.name.localeCompare(right.name);
    });

  return {
    summary: {
      workflowCount: workflowRows.length,
      blockedWorkflowCount: workflowRows.filter((workflow) => workflow.blockedStepCount > 0).length,
      runningWorkflowCount: workflowRows.filter((workflow) => workflow.summary.running > 0).length,
      readyWorkflowCount: workflowRows.filter((workflow) => workflow.summary.ready > 0).length,
      totalHandoffs: workflowRows.reduce((total, workflow) => total + workflow.handoffCount, 0)
    },
    workflows: workflowRows
  };
}


function buildAgentPortfolioSummary(workflows) {
  const normalizedWorkflows = Array.isArray(workflows) ? workflows : [];
  const rows = new Map();

  for (const workflow of normalizedWorkflows) {
    const snapshot = buildStudioSnapshot(workflow, { generatedAt: 'portfolio-agents' });
    const handoffs = buildHandoffQueue(workflow);

    for (const agent of snapshot.agentLoad) {
      if (!rows.has(agent.agent)) {
        rows.set(agent.agent, {
          agent: agent.agent,
          workflowCount: 0,
          activeSteps: 0,
          blockedSteps: 0,
          completedSteps: 0,
          blockedDownstreamSteps: 0,
          handoffTouches: 0,
          workflows: []
        });
      }

      const row = rows.get(agent.agent);
      const agentContext = buildAgentContext(workflow, agent.agent);
      const handoffTouches = handoffs.filter((handoff) => handoff.from.agent === agent.agent || handoff.to.agent === agent.agent).length;

      row.workflowCount += 1;
      row.activeSteps += agent.activeSteps;
      row.blockedSteps += agent.blockedSteps;
      row.completedSteps += agent.completedSteps;
      row.blockedDownstreamSteps += agentContext.summary.blockedDownstreamSteps;
      row.handoffTouches += handoffTouches;
      row.workflows.push({
        id: workflow.id,
        name: workflow.name,
        activeSteps: agent.activeSteps,
        blockedSteps: agent.blockedSteps,
        blockedDownstreamSteps: agentContext.summary.blockedDownstreamSteps
      });
    }
  }

  const agents = [...rows.values()]
    .map((row) => ({
      ...row,
      workflows: row.workflows.sort((left, right) => left.name.localeCompare(right.name))
    }))
    .sort((left, right) => {
      if (right.blockedDownstreamSteps !== left.blockedDownstreamSteps) {
        return right.blockedDownstreamSteps - left.blockedDownstreamSteps;
      }
      if (right.activeSteps !== left.activeSteps) {
        return right.activeSteps - left.activeSteps;
      }
      if (right.workflowCount !== left.workflowCount) {
        return right.workflowCount - left.workflowCount;
      }
      return left.agent.localeCompare(right.agent);
    });

  return {
    summary: {
      workflowCount: normalizedWorkflows.length,
      agentCount: agents.length,
      activeAgentCount: agents.filter((agent) => agent.activeSteps > 0).length,
      totalBlockedDownstreamSteps: agents.reduce((total, agent) => total + agent.blockedDownstreamSteps, 0),
      totalHandoffTouches: agents.reduce((total, agent) => total + agent.handoffTouches, 0)
    },
    agents
  };
}

function buildPortfolioHandoffs(workflows) {
  const normalizedWorkflows = Array.isArray(workflows) ? workflows : [];
  const workflowRows = normalizedWorkflows.map((workflow) => ({
    workflow: {
      id: workflow.id,
      name: workflow.name
    },
    handoffs: buildHandoffQueue(workflow)
  }));

  const handoffs = workflowRows
    .flatMap((entry) => entry.handoffs.map((handoff) => ({
      workflow: entry.workflow,
      from: handoff.from,
      to: handoff.to,
      blockedDependents: handoff.blockedDependents,
      readyDependents: handoff.readyDependents,
      waitingSteps: handoff.waitingSteps,
      notes: handoff.notes
    })))
    .sort((left, right) => {
      if (right.blockedDependents !== left.blockedDependents) {
        return right.blockedDependents - left.blockedDependents;
      }
      if (right.waitingSteps !== left.waitingSteps) {
        return right.waitingSteps - left.waitingSteps;
      }
      const workflowNameOrder = left.workflow.name.localeCompare(right.workflow.name);
      if (workflowNameOrder !== 0) {
        return workflowNameOrder;
      }
      return left.from.title.localeCompare(right.from.title);
    });

  return {
    summary: {
      workflowCount: normalizedWorkflows.length,
      workflowsWithHandoffs: workflowRows.filter((entry) => entry.handoffs.length > 0).length,
      totalHandoffs: handoffs.length,
      sourceAgentCount: new Set(handoffs.map((handoff) => handoff.from.agent).filter(Boolean)).size,
      targetAgentCount: new Set(handoffs.map((handoff) => handoff.to.agent).filter(Boolean)).size
    },
    handoffs
  };
}

function buildPortfolioTimeline(workflows, options = {}) {
  const normalizedWorkflows = Array.isArray(workflows) ? workflows : [];
  const availableWorkflows = normalizedWorkflows
    .map((workflow) => ({ id: workflow.id, name: workflow.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const availableWorkflowIds = new Set(availableWorkflows.map((workflow) => workflow.id));
  const workflowFilter = options.workflow && availableWorkflowIds.has(options.workflow) ? options.workflow : '';
  const workflowRows = normalizedWorkflows
    .filter((workflow) => !workflowFilter || workflow.id === workflowFilter)
    .map((workflow) => ({
      workflow: {
        id: workflow.id,
        name: workflow.name
      },
      events: buildTimeline(workflow.steps || []).map((event) => ({
        workflow: {
          id: workflow.id,
          name: workflow.name
        },
        ...event
      }))
    }));
  const availableAgents = [...new Set(workflowRows
    .flatMap((entry) => entry.events.map((event) => event.agent))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const agentFilter = options.agent && availableAgents.includes(options.agent) ? options.agent : '';
  const limitValue = Number.parseInt(String(options.limit || ''), 10);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 6;
  const events = workflowRows
    .flatMap((entry) => entry.events)
    .filter((event) => !agentFilter || event.agent === agentFilter)
    .sort((left, right) => {
      const timeOrder = String(right.at).localeCompare(String(left.at));
      if (timeOrder !== 0) {
        return timeOrder;
      }
      const typeOrder = left.type.localeCompare(right.type);
      if (typeOrder !== 0) {
        return typeOrder;
      }
      const workflowOrder = left.workflow.name.localeCompare(right.workflow.name);
      if (workflowOrder !== 0) {
        return workflowOrder;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);

  return {
    summary: {
      workflowCount: normalizedWorkflows.length,
      eventCount: events.length,
      filteredWorkflowCount: workflowRows.length,
      filteredAgentCount: agentFilter ? 1 : availableAgents.length
    },
    filters: {
      workflow: workflowFilter,
      agent: agentFilter,
      limit
    },
    availableWorkflows,
    availableAgents,
    events
  };
}

function buildPortfolioBlockers(workflows) {
  const normalizedWorkflows = Array.isArray(workflows) ? workflows : [];
  const workflowRows = normalizedWorkflows.map((workflow) => {
    const blockedSteps = (workflow.steps || [])
      .filter((step) => step.status === 'blocked')
      .map((step) => {
        const blockerContext = explainStepBlockers(workflow, step.id);
        const stepContext = explainStepContext(workflow, step.id);
        return {
          workflow: {
            id: workflow.id,
            name: workflow.name
          },
          step: {
            id: step.id,
            title: step.title,
            agent: step.agent,
            status: step.status
          },
          blockers: blockerContext.blockers,
          blockerAgents: [...new Set(blockerContext.blockers.map((blocker) => blocker.agent).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
          waitingOn: blockerContext.blockers.map((blocker) => blocker.title),
          downstreamDependents: stepContext.downstreamDependents,
          downstreamBlockedSteps: stepContext.downstreamDependents.filter((candidate) => candidate.status === 'blocked').length,
          downstreamReadySteps: stepContext.downstreamDependents.filter((candidate) => candidate.status === 'ready').length,
          reason: blockerContext.reason
        };
      });

    return {
      workflow: {
        id: workflow.id,
        name: workflow.name
      },
      blockedSteps
    };
  });

  const blockers = workflowRows
    .flatMap((entry) => entry.blockedSteps)
    .sort((left, right) => {
      if (right.downstreamBlockedSteps !== left.downstreamBlockedSteps) {
        return right.downstreamBlockedSteps - left.downstreamBlockedSteps;
      }
      if (right.downstreamReadySteps !== left.downstreamReadySteps) {
        return right.downstreamReadySteps - left.downstreamReadySteps;
      }
      if (right.blockers.length !== left.blockers.length) {
        return right.blockers.length - left.blockers.length;
      }
      const workflowNameOrder = left.workflow.name.localeCompare(right.workflow.name);
      if (workflowNameOrder !== 0) {
        return workflowNameOrder;
      }
      return left.step.title.localeCompare(right.step.title);
    });

  return {
    summary: {
      workflowCount: normalizedWorkflows.length,
      blockedWorkflowCount: workflowRows.filter((entry) => entry.blockedSteps.length > 0).length,
      totalBlockedSteps: blockers.length,
      uniqueBlockerAgentCount: new Set(blockers.flatMap((entry) => entry.blockerAgents)).size,
      totalBlockingRelationships: blockers.reduce((total, entry) => total + entry.blockers.length, 0)
    },
    blockers
  };
}

function buildDurationReport(workflow, options = {}) {
  const steps = workflow.steps || [];
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runningSteps = steps
    .filter((step) => step.status === 'running')
    .map((step) => ({
      id: step.id,
      title: step.title,
      agent: step.agent,
      status: step.status,
      elapsedMinutes: toWholeMinutes(step.startedAt, generatedAt),
      dependsOn: normalizeDependsOn(step)
    }))
    .filter((step) => step.elapsedMinutes !== null)
    .sort((left, right) => right.elapsedMinutes - left.elapsedMinutes || left.title.localeCompare(right.title));
  const completedSteps = steps
    .filter((step) => step.status === 'completed')
    .map((step) => ({
      id: step.id,
      title: step.title,
      agent: step.agent,
      status: step.status,
      cycleMinutes: toWholeMinutes(step.startedAt, step.finishedAt)
    }))
    .filter((step) => step.cycleMinutes !== null)
    .sort((left, right) => right.cycleMinutes - left.cycleMinutes || left.title.localeCompare(right.title));

  return {
    workflow: {
      id: workflow.id,
      name: workflow.name
    },
    generatedAt,
    summary: {
      runningStepCount: runningSteps.length,
      completedStepCount: completedSteps.length,
      longestRunningStep: runningSteps[0] || null,
      slowestCompletedStep: completedSteps[0] || null
    },
    runningSteps,
    completedSteps
  };
}

module.exports = {
  buildStudioSnapshot,
  buildFilteredTimeline,
  buildAgentContext,
  buildAgentPortfolioSummary,
  buildPortfolioBlockers,
  buildPortfolioHandoffs,
  buildPortfolioTimeline,
  buildHandoffQueue,
  buildDurationReport,
  buildPriorityQueue,
  buildPortfolioOverview,
  explainStepBlockers,
  explainStepContext
};