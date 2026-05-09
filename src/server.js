const http = require('node:http');
const { URL } = require('node:url');
const { buildStudioSnapshot, buildFilteredTimeline, buildAgentContext, buildAgentPortfolioSummary, buildPortfolioBlockers, buildPortfolioHandoffs, buildPortfolioTimeline, buildHandoffQueue, buildDurationReport, buildPriorityQueue, buildPortfolioOverview, explainStepContext } = require('./studio');
const { loadWorkflows, getWorkflowById, buildWorkflowCatalog } = require('./workflows');

function pickDefaultStepId(workflow) {
  const steps = workflow.steps || [];
  return steps.find((step) => step.status === 'blocked')?.id
    || steps.find((step) => step.status === 'running')?.id
    || steps[0]?.id
    || null;
}

function renderStepInspector(selectedStepContext, workflow, timelineFilters) {
  if (!selectedStepContext) {
    return '<p>No step details available yet.</p>';
  }

  const stepOptions = (workflow.steps || [])
    .map((step) => {
      const selectedAttr = step.id === selectedStepContext.step.id ? ' selected' : '';
      return `<option value="${step.id}"${selectedAttr}>${step.title} · ${step.status}</option>`;
    })
    .join('');
  const blockerItems = selectedStepContext.blockers
    .map(
      (step) => `<li><strong>${step.title}</strong> · ${step.agent} · <code>${step.status}</code></li>`
    )
    .join('');
  const downstreamItems = selectedStepContext.downstreamDependents
    .map(
      (step) => `<li><strong>${step.title}</strong> · ${step.agent} · <code>${step.status}</code></li>`
    )
    .join('');
  const notes = selectedStepContext.step.notes
    ? `<p><strong>Notes:</strong> ${selectedStepContext.step.notes}</p>`
    : '';
  const timelineHiddenFields = [
    timelineFilters?.agent ? `<input type="hidden" name="agent" value="${timelineFilters.agent}">` : '',
    timelineFilters?.limit ? `<input type="hidden" name="limit" value="${timelineFilters.limit}">` : ''
  ].join('');

  return `
    <form method="get" style="display: grid; gap: 8px; margin-bottom: 16px;">
      <input type="hidden" name="workflow" value="${workflow.id}">
      ${timelineHiddenFields}
      <label>
        <strong>Inspect step</strong><br>
        <select name="step" onchange="this.form.submit()">${stepOptions}</select>
      </label>
      <noscript><button type="submit">Inspect</button></noscript>
    </form>
    <h3 style="margin-top: 0;">${selectedStepContext.step.title}</h3>
    <p><strong>Agent:</strong> ${selectedStepContext.step.agent} · <strong>Status:</strong> <code>${selectedStepContext.step.status}</code></p>
    <p><strong>Depends on:</strong> <code>${selectedStepContext.step.dependsOn.join(', ') || 'none'}</code></p>
    ${notes}
    <div class="two-up" style="margin-top: 16px;">
      <div>
        <h3>Blocking now</h3>
        <ul>${blockerItems || '<li>No open blockers.</li>'}</ul>
      </div>
      <div>
        <h3>Downstream impact</h3>
        <ul>${downstreamItems || '<li>No downstream dependents yet.</li>'}</ul>
      </div>
    </div>
  `;
}

function renderRecentActivity(timeline, workflow, selectedStepId) {
  const agentOptions = ['<option value="">All agents</option>']
    .concat(timeline.availableAgents.map((agent) => `<option value="${agent}"${agent === timeline.filters.agent ? ' selected' : ''}>${agent}</option>`))
    .join('');
  const limitOptions = [5, 3, 2, 1]
    .map((value) => `<option value="${value}"${value === timeline.filters.limit ? ' selected' : ''}>${value}</option>`)
    .join('');
  const events = timeline.events
    .map((event) => `<li><strong>${event.title}</strong> · ${event.agent} · <code>${event.type}</code><br><small>${event.at}</small></li>`)
    .join('');
  const stepField = selectedStepId ? `<input type="hidden" name="step" value="${selectedStepId}">` : '';

  return `
    <form method="get" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; align-items: end;">
      <input type="hidden" name="workflow" value="${workflow.id}">
      ${stepField}
      <label>
        <strong>Filter timeline by agent</strong><br>
        <select name="agent" onchange="this.form.submit()">${agentOptions}</select>
      </label>
      <label>
        <strong>Limit events</strong><br>
        <select name="limit" onchange="this.form.submit()">${limitOptions}</select>
      </label>
      <noscript><button type="submit">Refresh timeline</button></noscript>
    </form>
    <ul>${events || '<li>No timeline events match the current filters.</li>'}</ul>
  `;
}

function renderAgentFocus(agentContext, workflow, selectedStepId, timeline) {
  if (!agentContext?.agent?.name) {
    return '';
  }

  const stepField = selectedStepId ? `&step=${selectedStepId}` : '';
  const limitField = timeline?.filters?.limit ? `&limit=${timeline.filters.limit}` : '';
  const stepItems = agentContext.steps
    .map((step) => {
      const blocking = step.blocking.length
        ? `<br><small>Blocking: ${step.blocking.map((candidate) => candidate.title).join(', ')}</small>`
        : '';
      const blockedBy = step.blockedBy.length
        ? `<br><small>Blocked by: ${step.blockedBy.map((candidate) => candidate.title).join(', ')}</small>`
        : '';
      return `<li><strong>${step.title}</strong> · <code>${step.status}</code>${blocking}${blockedBy}</li>`;
    })
    .join('');

  return `
    <div style="display: flex; justify-content: space-between; gap: 12px; align-items: start;">
      <div>
        <h2>Agent focus</h2>
        <p><strong>${agentContext.agent.name}</strong> owns ${agentContext.summary.totalSteps} step${agentContext.summary.totalSteps === 1 ? '' : 's'} in this workflow.</p>
      </div>
      <a href="/?workflow=${workflow.id}${stepField}${limitField}">Clear focus</a>
    </div>
    <div class="grid" style="margin-bottom: 16px;">
      <section class="card"><strong>Running</strong><div>${agentContext.summary.running}</div></section>
      <section class="card"><strong>Ready</strong><div>${agentContext.summary.ready}</div></section>
      <section class="card"><strong>Blocked downstream steps</strong><div>${agentContext.summary.blockedDownstreamSteps}</div></section>
    </div>
    <ul>${stepItems || '<li>No steps owned by this agent in the current workflow.</li>'}</ul>
  `;
}

function renderHandoffQueue(handoffQueue) {
  const handoffItems = handoffQueue
    .map((handoff) => {
      const waitingCopy = `${handoff.waitingSteps} waiting step${handoff.waitingSteps === 1 ? '' : 's'}`;
      const notes = handoff.notes ? `<br><small>${handoff.notes}</small>` : '';
      return `<li><strong>${handoff.from.agent} → ${handoff.to.agent}</strong><br>${handoff.from.title} → ${handoff.to.title} · <code>${handoff.from.status}</code> → <code>${handoff.to.status}</code><br>${waitingCopy} · ${handoff.blockedDependents} blocked dependent${handoff.blockedDependents === 1 ? '' : 's'}${notes}</li>`;
    })
    .join('');

  return `<ul>${handoffItems || '<li>No unresolved agent handoffs right now.</li>'}</ul>`;
}

function renderDurationInsights(durationReport) {
  const longestRunningStep = durationReport.summary.longestRunningStep;
  const slowestCompletedStep = durationReport.summary.slowestCompletedStep;
  const runningCopy = longestRunningStep
    ? `<p><strong>Longest running step</strong><br>${longestRunningStep.title} · ${longestRunningStep.agent} · <code>${longestRunningStep.elapsedMinutes} min</code></p>`
    : '<p><strong>Longest running step</strong><br>No running steps with timestamps yet.</p>';
  const completedCopy = slowestCompletedStep
    ? `<p><strong>Slowest completed step</strong><br>${slowestCompletedStep.title} · ${slowestCompletedStep.agent} · <code>${slowestCompletedStep.cycleMinutes} min</code></p>`
    : '<p><strong>Slowest completed step</strong><br>No completed step timings yet.</p>';

  return `
    <div class="two-up">
      <div>${runningCopy}</div>
      <div>${completedCopy}</div>
    </div>
  `;
}

function renderPriorityQueue(priorityQueue) {
  const items = priorityQueue
    .map((step) => {
      const directCopy = `${step.directDependents} direct dependent${step.directDependents === 1 ? '' : 's'}`;
      const downstreamCopy = `${step.downstreamSteps} downstream step${step.downstreamSteps === 1 ? '' : 's'}`;
      const blockedCopy = `${step.blockedDownstreamSteps} blocked`;
      const readyCopy = `${step.readyDownstreamSteps} ready`;
      return `<li><strong>${step.title}</strong> · ${step.agent} · <code>${step.status}</code><br>${downstreamCopy} · ${directCopy}<br><small>Downstream impact: ${blockedCopy} / ${readyCopy}</small></li>`;
    })
    .join('');

  return `<ul>${items || '<li>No unfinished workflow steps to prioritize yet.</li>'}</ul>`;
}

function renderPortfolioOverview(portfolioOverview) {
  const portfolioCards = (portfolioOverview?.workflows || [])
    .map((workflowEntry) => {
      const topStep = workflowEntry.highestLeverageStep
        ? `<br><small>Top next step: ${workflowEntry.highestLeverageStep.title} · ${workflowEntry.highestLeverageStep.agent} · <code>${workflowEntry.highestLeverageStep.status}</code></small>`
        : '<br><small>Top next step: none</small>';
      const bottleneckCopy = workflowEntry.bottleneckAgents[0]
        ? `${workflowEntry.bottleneckAgents[0].agent} blocking ${workflowEntry.bottleneckAgents[0].blockedSteps}`
        : 'No bottleneck agent';
      return `<li class="workflow-card"><a href="/?workflow=${workflowEntry.id}"><strong>${workflowEntry.name}</strong></a><br><span>${workflowEntry.summary.totalSteps} steps · running ${workflowEntry.summary.running} · ready ${workflowEntry.summary.ready} · blocked ${workflowEntry.summary.blocked}</span><br><small>${workflowEntry.handoffCount} handoff${workflowEntry.handoffCount === 1 ? '' : 's'} · ${bottleneckCopy}</small>${topStep}</li>`;
    })
    .join('');

  return `
    <div class="grid">
      <section class="card"><strong>Portfolio workflows</strong><div>${portfolioOverview.summary.workflowCount}</div></section>
      <section class="card"><strong>Blocked workflows</strong><div>${portfolioOverview.summary.blockedWorkflowCount}</div></section>
      <section class="card"><strong>Cross-workflow handoffs</strong><div>${portfolioOverview.summary.totalHandoffs}</div></section>
    </div>
    <ul style="padding-left: 0; margin: 0;">${portfolioCards || '<li class="workflow-card">No workflows loaded.</li>'}</ul>
  `;
}


function renderPortfolioAgentSummary(agentPortfolioSummary) {
  const agentCards = (agentPortfolioSummary?.agents || [])
    .map((agentEntry) => {
      const workflowCopy = agentEntry.workflows
        .map((workflow) => `${workflow.name} (${workflow.activeSteps} active / ${workflow.blockedDownstreamSteps} blocked downstream)`)
        .join(' · ');
      return `<li class="workflow-card"><strong>${agentEntry.agent}</strong><br><span>${agentEntry.workflowCount} workflow${agentEntry.workflowCount === 1 ? '' : 's'} · ${agentEntry.activeSteps} active · ${agentEntry.blockedDownstreamSteps} blocked downstream</span><br><small>${agentEntry.handoffTouches} handoff touch${agentEntry.handoffTouches === 1 ? '' : 'es'} · ${workflowCopy || 'No workflow assignments'}</small></li>`;
    })
    .join('');

  return `
    <div class="grid"> 
      <section class="card"><strong>Portfolio agents</strong><div>${agentPortfolioSummary.summary.agentCount}</div></section>
      <section class="card"><strong>Active agents</strong><div>${agentPortfolioSummary.summary.activeAgentCount}</div></section>
      <section class="card"><strong>Blocked downstream steps</strong><div>${agentPortfolioSummary.summary.totalBlockedDownstreamSteps}</div></section>
    </div>
    <ul style="padding-left: 0; margin: 0;">${agentCards || '<li class="workflow-card">No agent portfolio data yet.</li>'}</ul>
  `;
}

function renderPortfolioHandoffs(portfolioHandoffs) {
  const handoffItems = (portfolioHandoffs?.handoffs || [])
    .map((handoff) => {
      const waitingCopy = `${handoff.waitingSteps} waiting step${handoff.waitingSteps === 1 ? '' : 's'}`;
      const readyCopy = `${handoff.readyDependents} ready dependent${handoff.readyDependents === 1 ? '' : 's'}`;
      const notes = handoff.notes ? `<br><small>${handoff.notes}</small>` : '';
      return `<li class="workflow-card"><strong>${handoff.workflow.name}</strong><br><span>${handoff.from.agent} → ${handoff.to.agent}</span><br><small>${handoff.from.title} → ${handoff.to.title} · ${handoff.blockedDependents} blocked dependent${handoff.blockedDependents === 1 ? '' : 's'} · ${readyCopy} · ${waitingCopy}</small>${notes}</li>`;
    })
    .join('');

  return `
    <div class="grid">
      <section class="card"><strong>Workflows with handoffs</strong><div>${portfolioHandoffs.summary.workflowsWithHandoffs}</div></section>
      <section class="card"><strong>Total handoffs</strong><div>${portfolioHandoffs.summary.totalHandoffs}</div></section>
      <section class="card"><strong>Source agents</strong><div>${portfolioHandoffs.summary.sourceAgentCount}</div></section>
    </div>
    <ul style="padding-left: 0; margin: 0;">${handoffItems || '<li class="workflow-card">No cross-workflow handoffs right now.</li>'}</ul>
  `;
}

function renderPortfolioTimeline(portfolioTimeline, selectedWorkflowId, selectedStepId) {
  const workflowOptions = ['<option value="">All workflows</option>']
    .concat((portfolioTimeline?.availableWorkflows || []).map((workflow) => (
      `<option value="${workflow.id}"${workflow.id === portfolioTimeline.filters.workflow ? ' selected' : ''}>${workflow.name}</option>`
    )))
    .join('');
  const agentOptions = ['<option value="">All agents</option>']
    .concat((portfolioTimeline?.availableAgents || []).map((agent) => (
      `<option value="${agent}"${agent === portfolioTimeline.filters.agent ? ' selected' : ''}>${agent}</option>`
    )))
    .join('');
  const limitOptions = [6, 4, 2, 1]
    .map((value) => `<option value="${value}"${value === portfolioTimeline.filters.limit ? ' selected' : ''}>${value}</option>`)
    .join('');
  const stepField = selectedStepId ? `<input type="hidden" name="step" value="${selectedStepId}">` : '';
  const events = (portfolioTimeline?.events || [])
    .map((event) => `<li class="workflow-card"><strong>${event.workflow.name}</strong><br><span>${event.title} · ${event.agent} · <code>${event.type}</code></span><br><small>${event.at}</small></li>`)
    .join('');

  return `
    <div class="grid">
      <section class="card"><strong>Cross-workflow activity</strong><div>${portfolioTimeline.summary.eventCount}</div></section>
      <section class="card"><strong>Visible workflows</strong><div>${portfolioTimeline.summary.filteredWorkflowCount}</div></section>
      <section class="card"><strong>Visible agents</strong><div>${portfolioTimeline.summary.filteredAgentCount}</div></section>
    </div>
    <form method="get" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; align-items: end;">
      <input type="hidden" name="workflow" value="${selectedWorkflowId}">
      ${stepField}
      <label>
        <strong>Filter portfolio by workflow</strong><br>
        <select name="portfolioWorkflow" onchange="this.form.submit()">${workflowOptions}</select>
      </label>
      <label>
        <strong>Filter portfolio by agent</strong><br>
        <select name="portfolioAgent" onchange="this.form.submit()">${agentOptions}</select>
      </label>
      <label>
        <strong>Limit portfolio events</strong><br>
        <select name="portfolioLimit" onchange="this.form.submit()">${limitOptions}</select>
      </label>
      <noscript><button type="submit">Refresh portfolio timeline</button></noscript>
    </form>
    <ul style="padding-left: 0; margin: 0;">${events || '<li class="workflow-card">No activity events match the current portfolio filters.</li>'}</ul>
  `;
}

function renderPortfolioBlockers(portfolioBlockers) {
  const blockerItems = (portfolioBlockers?.blockers || [])
    .map((entry) => {
      const blockerAgents = entry.blockerAgents.length ? entry.blockerAgents.join(', ') : 'Unknown';
      const waitingOn = entry.waitingOn.length ? entry.waitingOn.join(', ') : 'none';
      const downstreamImpact = `${entry.downstreamBlockedSteps} blocked downstream · ${entry.downstreamReadySteps} ready downstream`;
      const blockerTitles = entry.blockers
        .map((blocker) => `${blocker.title} (${blocker.agent} · ${blocker.status})`)
        .join(' · ');
      return `<li class="workflow-card"><strong>${entry.workflow.name}</strong><br><span>${entry.step.title} · ${entry.step.agent}</span><br><small>Waiting on: ${waitingOn}</small><br><small>Blocking agents: ${blockerAgents}</small><br><small>Downstream impact: ${downstreamImpact}</small><br><small>${blockerTitles || entry.reason}</small></li>`;
    })
    .join('');

  return `
    <div class="grid">
      <section class="card"><strong>Blocked workflows</strong><div>${portfolioBlockers.summary.blockedWorkflowCount}</div></section>
      <section class="card"><strong>Total blocked steps</strong><div>${portfolioBlockers.summary.totalBlockedSteps}</div></section>
      <section class="card"><strong>Blocking agents</strong><div>${portfolioBlockers.summary.uniqueBlockerAgentCount}</div></section>
    </div>
    <ul style="padding-left: 0; margin: 0;">${blockerItems || '<li class="workflow-card">No blocked steps across the portfolio.</li>'}</ul>
  `;
}

function renderWorkflowGraph(graph, selectedStepId) {
  const cards = (graph?.nodes || [])
    .map((node) => {
      const selectedClass = node.id === selectedStepId ? 'graph-step selected' : 'graph-step';
      const dependsOn = node.dependsOn.length ? node.dependsOn.join(', ') : 'none';
      const downstream = node.downstream.length ? node.downstream.join(', ') : 'none';
      const openBlockers = node.openBlockers.length
        ? `<div><small>Open blockers: ${node.openBlockers.join(', ')}</small></div>`
        : '<div><small>Open blockers: none</small></div>';
      return `<li class="${selectedClass}"><strong>${node.title}</strong><br><small>${node.agent} · <code>${node.status}</code></small><div><small>Depends on: ${dependsOn}</small></div><div><small>Downstream: ${downstream}</small></div>${openBlockers}</li>`;
    })
    .join('');
  const edges = (graph?.edges || [])
    .map((edge) => `<li><code>${edge.from}</code> → <code>${edge.to}</code></li>`)
    .join('');

  return `
    <div class="graph-layout">
      <div>
        <h3 style="margin-top: 0;">Steps</h3>
        <ul class="graph-grid">${cards || '<li class="graph-step">No workflow steps loaded.</li>'}</ul>
      </div>
      <div>
        <h3 style="margin-top: 0;">Dependencies</h3>
        <ul>${edges || '<li>No dependency edges yet.</li>'}</ul>
      </div>
    </div>
  `;
}

function renderHtml({ workflow, snapshot, catalog, portfolioOverview, agentPortfolioSummary, portfolioBlockers, portfolioHandoffs, portfolioTimeline, selectedWorkflowId, selectedStepContext, timeline, agentContext, durationReport, priorityQueue }) {
  const stepCards = snapshot.blockedSteps
    .map(
      (step) => `<li><strong>${step.title}</strong> · ${step.step.agent}<br>${step.reason || 'No blocker details yet.'}</li>`
    )
    .join('');
  const readyItems = snapshot.readyQueue
    .map(
      (step) => `<li><strong>${step.title}</strong> · ${step.agent}<br>Depends on: <code>${step.dependsOn.join(', ') || 'none'}</code></li>`
    )
    .join('');
  const bottleneckItems = snapshot.bottleneckAgents
    .map(
      (agent) => `<li><strong>${agent.agent}</strong> is blocking ${agent.blockedSteps} downstream step${agent.blockedSteps === 1 ? '' : 's'}.</li>`
    )
    .join('');
  const attentionItems = snapshot.attentionQueue
    .map((step) => {
      const blockedCopy = `${step.blockedDependents} blocked dependent${step.blockedDependents === 1 ? '' : 's'}`;
      const readyCopy = `${step.readyDependents} ready dependent${step.readyDependents === 1 ? '' : 's'}`;
      return `<li><strong>${step.title}</strong> · ${step.agent} · <code>${step.status}</code><br>${blockedCopy} · ${readyCopy}</li>`;
    })
    .join('');
  const agentRows = snapshot.agentLoad
    .map((agent) => {
      const stepField = selectedStepContext?.step?.id ? `&step=${selectedStepContext.step.id}` : '';
      const limitField = timeline?.filters?.limit ? `&limit=${timeline.filters.limit}` : '';
      const agentCell = `<a href="/?workflow=${workflow.id}&agent=${agent.agent}${stepField}${limitField}">${agent.agent}</a>`;
      return `<tr><td>${agentCell}</td><td>${agent.activeSteps}</td><td>${agent.blockedSteps}</td><td>${agent.completedSteps}</td></tr>`;
    })
    .join('');
  const workflowCards = catalog
    .map((workflowEntry) => {
      const selectedClass = workflowEntry.id === selectedWorkflowId ? 'workflow-card selected' : 'workflow-card';
      return `<li class="${selectedClass}"><a href="/?workflow=${workflowEntry.id}"><strong>${workflowEntry.name}</strong></a><br><span>${workflowEntry.stepCount} steps · ready ${workflowEntry.summary.ready} · blocked ${workflowEntry.summary.blocked}</span></li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OpenAgent-Desktop</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; color: #111827; background: #f8fafc; }
      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
      .two-up { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .layout { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 16px; align-items: start; }
      .stack { display: grid; gap: 16px; }
      .card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
      .workflow-card { list-style: none; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
      .workflow-card.selected { border-color: #2563eb; background: #eff6ff; }
      .workflow-card a { color: inherit; text-decoration: none; }
      .graph-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(220px, 1fr); gap: 16px; }
      .graph-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; list-style: none; padding-left: 0; }
      .graph-step { border: 1px solid #dbeafe; border-radius: 10px; padding: 12px; background: #f8fbff; }
      .graph-step.selected { border-color: #2563eb; box-shadow: inset 0 0 0 1px #2563eb; }
      table { width: 100%; border-collapse: collapse; }
      td, th { padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
      ul { padding-left: 20px; }
      code { background: #e2e8f0; padding: 2px 6px; border-radius: 6px; }
      select { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: white; }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside class="card">
        <h2>Workflow catalog</h2>
        <ul style="padding-left: 0; margin: 0;">${workflowCards}</ul>
      </aside>
      <main class="stack">
        <section class="card">
          <h1>${snapshot.workflow.name}</h1>
          <p>Local orchestration snapshot generated at <code>${snapshot.generatedAt}</code>.</p>
        </section>
        <section class="card">
          <h2>Workflow portfolio</h2>
          ${renderPortfolioOverview(portfolioOverview)}
        </section>
        <section class="card">
          <h2>Portfolio agent load</h2>
          ${renderPortfolioAgentSummary(agentPortfolioSummary)}
        </section>
        <section class="card">
          <h2>Portfolio blocker queue</h2>
          ${renderPortfolioBlockers(portfolioBlockers)}
        </section>
        <section class="card">
          <h2>Portfolio handoff queue</h2>
          ${renderPortfolioHandoffs(portfolioHandoffs)}
        </section>
        <section class="card">
          <h2>Portfolio timeline</h2>
          ${renderPortfolioTimeline(portfolioTimeline, workflow.id, selectedStepContext?.step?.id || null)}
        </section>
        <div class="grid">
          <section class="card"><strong>Total steps</strong><div>${snapshot.summary.totalSteps}</div></section>
          <section class="card"><strong>Running</strong><div>${snapshot.summary.running}</div></section>
          <section class="card"><strong>Blocked</strong><div>${snapshot.summary.blocked}</div></section>
        </div>
        <section class="card">
          <h2>Step inspector</h2>
          ${renderStepInspector(selectedStepContext, workflow, timeline.filters)}
        </section>
        <section class="card">
          <h2>Workflow graph</h2>
          ${renderWorkflowGraph(snapshot.graph, selectedStepContext?.step?.id || null)}
        </section>
        <div class="two-up">
          <section class="card">
            <h2>Ready next</h2>
            <ul>${readyItems || '<li>No ready work yet.</li>'}</ul>
          </section>
          <section class="card">
            <h2>Bottleneck agents</h2>
            <ul>${bottleneckItems || '<li>No downstream bottlenecks detected.</li>'}</ul>
          </section>
        </div>
        <section class="card">
          <h2>Attention queue</h2>
          <ul>${attentionItems || '<li>No running or blocked work needs escalation right now.</li>'}</ul>
        </section>
        <section class="card">
          <h2>Agent handoffs</h2>
          ${renderHandoffQueue(snapshot.handoffQueue || [])}
        </section>
        <section class="card">
          <h2>Timing insights</h2>
          ${renderDurationInsights(durationReport)}
        </section>
        <section class="card">
          <h2>Highest leverage steps</h2>
          ${renderPriorityQueue(priorityQueue)}
        </section>
        <section class="card">
          <h2>Blocked steps</h2>
          <ul>${stepCards || '<li>No blocked steps.</li>'}</ul>
        </section>
        <section class="card">
          <h2>Recent activity</h2>
          ${renderRecentActivity(timeline, workflow, selectedStepContext?.step?.id || null)}
        </section>
        <section class="card">
          ${renderAgentFocus(agentContext, workflow, selectedStepContext?.step?.id || null, timeline) || '<h2>Agent focus</h2><p>Filter the timeline by agent to inspect one owner\'s current workload and downstream impact.</p>'}
        </section>
        <section class="card">
          <h2>Agent load</h2>
          <table>
            <thead><tr><th>Agent</th><th>Active</th><th>Blocked</th><th>Completed</th></tr></thead>
            <tbody>${agentRows}</tbody>
          </table>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function createApp() {
  const workflows = loadWorkflows();
  const catalog = buildWorkflowCatalog(workflows);
  const defaultWorkflow = getWorkflowById(workflows, 'customer-bugfix') || workflows[0] || null;
  const portfolioOverview = buildPortfolioOverview(workflows);
  const agentPortfolioSummary = buildAgentPortfolioSummary(workflows);
  const portfolioBlockers = buildPortfolioBlockers(workflows);
  const portfolioHandoffs = buildPortfolioHandoffs(workflows);

  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const requestedWorkflowId = requestUrl.searchParams.get('workflow');
    const workflow = requestedWorkflowId ? getWorkflowById(workflows, requestedWorkflowId) : defaultWorkflow;

    if (requestedWorkflowId && !workflow) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Unknown workflow: ${requestedWorkflowId}` }));
      return;
    }

    if (!workflow) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'No workflow fixtures available' }));
      return;
    }

    const snapshot = buildStudioSnapshot(workflow);
    const handoffQueue = buildHandoffQueue(workflow);
    const durationReport = buildDurationReport(workflow, {
      generatedAt: requestUrl.searchParams.get('generatedAt') || snapshot.generatedAt
    });
    const priorityQueue = buildPriorityQueue(workflow);
    const selectedStepId = requestUrl.searchParams.get('step') || pickDefaultStepId(workflow);
    const timeline = buildFilteredTimeline(workflow, {
      agent: requestUrl.searchParams.get('agent') || '',
      limit: requestUrl.searchParams.get('limit') || ''
    });
    const portfolioTimeline = buildPortfolioTimeline(workflows, {
      workflow: requestUrl.searchParams.get('portfolioWorkflow') || requestUrl.searchParams.get('workflow') || '',
      agent: requestUrl.searchParams.get('portfolioAgent') || requestUrl.searchParams.get('agent') || '',
      limit: requestUrl.searchParams.get('portfolioLimit') || requestUrl.searchParams.get('limit') || ''
    });
    const agentContext = timeline.filters.agent ? buildAgentContext(workflow, timeline.filters.agent) : null;
    let selectedStepContext = null;

    if (selectedStepId) {
      try {
        selectedStepContext = explainStepContext(workflow, selectedStepId);
      } catch (error) {
        if (requestUrl.pathname === '/api/step') {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
      }
    }

    if (requestUrl.pathname === '/api/workflows') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ workflows: catalog }));
      return;
    }

    if (requestUrl.pathname === '/api/snapshot') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    if (requestUrl.pathname === '/api/timeline') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(timeline));
      return;
    }

    if (requestUrl.pathname === '/api/agent') {
      if (!agentContext?.agent?.name) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `Unknown agent: ${requestUrl.searchParams.get('agent') || ''}` }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(agentContext));
      return;
    }

    if (requestUrl.pathname === '/api/handoffs') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        workflow: snapshot.workflow,
        handoffs: handoffQueue
      }));
      return;
    }

    if (requestUrl.pathname === '/api/durations') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(durationReport));
      return;
    }

    if (requestUrl.pathname === '/api/priorities') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        workflow: snapshot.workflow,
        priorities: priorityQueue
      }));
      return;
    }

    if (requestUrl.pathname === '/api/portfolio') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(portfolioOverview));
      return;
    }

    if (requestUrl.pathname === '/api/portfolio/agents') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(agentPortfolioSummary));
      return;
    }

    if (requestUrl.pathname === '/api/portfolio/blockers') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(portfolioBlockers));
      return;
    }

    if (requestUrl.pathname === '/api/portfolio/handoffs') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(portfolioHandoffs));
      return;
    }

    if (requestUrl.pathname === '/api/portfolio/timeline') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(portfolioTimeline));
      return;
    }

    if (requestUrl.pathname === '/api/step') {
      if (!selectedStepContext) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `Unknown step: ${selectedStepId}` }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(selectedStepContext));
      return;
    }

    if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderHtml({ workflow, snapshot, catalog, portfolioOverview, agentPortfolioSummary, portfolioBlockers, portfolioHandoffs, portfolioTimeline, selectedWorkflowId: workflow.id, selectedStepContext, timeline, agentContext, durationReport, priorityQueue }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4488);
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`OpenAgent-Desktop listening on http://127.0.0.1:${port}`);
  });
}

module.exports = {
  createApp
};
