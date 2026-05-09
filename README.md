# OpenAgent-Desktop

OpenAgent-Desktop is a local-first orchestration studio for multi-agent workflows. The current MVP now ships with a tiny multi-workflow browser dashboard backed by local JSON fixtures, including:

- a workflow graph panel that exposes per-step dependencies, downstream links, and open blockers in the browser UI
- `/api/snapshot` for returning the default workflow snapshot, including graph dependency metadata for each step
- per-agent load overview
- blocker explanations for stuck steps
- ready-next queue for immediately unblocked work
- attention queue for running/blocked steps that are holding downstream work
- bottleneck agent summary so you can see which upstream actor is stalling the workflow
- an agent handoff queue that turns unresolved cross-agent dependencies into a concrete waiting list
- a step inspector that shows the selected step's blockers and downstream impact
- a tiny browser UI backed by `/api/snapshot`
- a workflow catalog + selector so you can switch between local workflow fixtures without editing code
- `/api/workflows` for listing the available local fixtures and headline counts
- `/api/step` for drilling into one step's blocker/downstream dependency context
- a recent-activity timeline panel with agent filtering + event limits for live drilldown
- an agent-focus panel that turns the timeline filter into a per-owner workload + downstream impact drilldown
- timing insights for the longest running step and slowest completed cycle in the current workflow
- a highest-leverage step queue that ranks unfinished work by downstream impact
- a cross-workflow portfolio overview that highlights blocked workflows, handoff load, and the top next step for each local workflow
- a portfolio agent load panel plus `/api/portfolio/agents` so you can see who owns the most active work and blocked downstream pressure across every workflow fixture
- a portfolio blocker queue plus `/api/portfolio/blockers` so you can triage every blocked step by waiting agent, blocker reason, and downstream impact across the full fixture set
- a portfolio handoff queue plus `/api/portfolio/handoffs` so you can triage unresolved agent-to-agent dependencies across every local workflow in one place
- a portfolio activity timeline plus `/api/portfolio/timeline` so you can filter recent cross-workflow events by workflow, agent, and event limit
- `/api/timeline` for returning filtered activity events per workflow
- `/api/agent` for summarizing one agent's owned steps and blocked downstream work
- `/api/handoffs` for returning the unresolved cross-agent dependency queue per workflow
- `/api/durations` for returning elapsed running-step and completed-cycle timing summaries
- `/api/priorities` for ranking unfinished steps by downstream workflow impact
- `/api/portfolio` for comparing all local workflows by risk, handoff count, and highest-leverage next step

## Run

```bash
npm test
npm start
```

Then open `http://127.0.0.1:4488`.

## API

- `GET /api/workflows` — list available local workflow fixtures and headline counts
- `GET /api/snapshot` — return the default workflow snapshot (including ready, bottleneck, attention, handoff, and graph dependency data)
- `GET /api/snapshot?workflow=content-launch` — return a specific workflow snapshot
- `GET /api/step?workflow=customer-bugfix&step=qa-signoff` — inspect one step's blockers and downstream dependents
- `GET /api/timeline?workflow=content-launch&agent=Producer&limit=1` — return filtered recent activity events for one workflow
- `GET /api/agent?workflow=content-launch&agent=Producer` — summarize one agent's owned steps plus blocked downstream work
- `GET /api/handoffs?workflow=content-launch` — list unresolved cross-agent handoffs ordered by downstream impact
- `GET /api/durations?workflow=content-launch&generatedAt=2026-04-16T09:35:00Z` — summarize the longest running step and slowest completed cycle with deterministic timing
- `GET /api/priorities?workflow=content-launch` — rank unfinished steps by downstream impact so the studio can highlight the highest-leverage next action
- `GET /api/portfolio` — compare every local workflow by blocked/running state, handoff load, and the top next step to unblock
- `GET /api/portfolio/agents` — roll up cross-workflow owner load, blocked downstream pressure, and handoff touches across the full fixture set
- `GET /api/portfolio/blockers` — flatten blocked steps across workflows with blocker owners, reasons, and downstream impact
- `GET /api/portfolio/handoffs` — flatten unresolved cross-workflow handoffs into one triage queue with workflow context and downstream impact
- `GET /api/portfolio/timeline?workflow=content-launch&agent=Producer&limit=1` — return recent cross-workflow activity with optional workflow, agent, and event-limit filters

Use `/?workflow=content-launch&step=record-voiceover` to open the browser UI with a specific workflow + inspected step selected.
Use `/?workflow=content-launch&step=record-voiceover&agent=Producer&limit=2` to keep the step inspector pinned while narrowing the recent-activity timeline and opening the matching agent-focus panel.
