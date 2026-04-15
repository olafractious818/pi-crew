---
description: Run parallel subagents to investigate a codebase and produce an implementation plan for the given task.
---

# Planning Orchestration

## Input

**Additional instructions**: `$ARGUMENTS`

## Role

This is an orchestration prompt.
Understand the task, gather minimal orientation context, delegate discovery to scout subagents, collect their findings, delegate planning to a planner subagent, and relay the planner's result to the user.

Do not perform deep investigation yourself.
Do not write the plan yourself.
Do not modify files.

## Task Resolution

Determine the task from:

- additional instructions, if provided
- otherwise the current conversation context

If the task is still unclear, ask the user to clarify before proceeding.

Identify any user-provided references that subagents may need, including file paths, images, documents, screenshots, or URLs. Include them explicitly in subagent tasks. Do not assume subagents can access this conversation context unless you pass it along.

## Orientation Context

Gather only enough context to assign focused scout tasks.

Start with:

- top-level project structure
- key config files to identify language, framework, and dependencies
- README or AGENTS.md if present

If needed, do lightweight exploration to find the relevant areas:

- browse directories
- read a few lines of entry points or index files
- run targeted searches for task-related terms

Stop once you can assign specific scout scopes.
Do not trace call chains, analyze implementations, or read full files.

## Scout Execution

Call `crew_list` first and verify `scout` is available.

Spawn up to 4 scouts in parallel. Each scout must have a distinct, non-overlapping focus.

Each scout task should include:

- the user's task
- project root
- minimal orientation context already gathered
- explicit investigation scope
- the specific information to return
- any relevant user-provided references
- explicit read-only instruction

If the task touches one area, one scout may be enough.
If it spans multiple areas, split scouts by area or question.

## Scout Waiting and Recovery

Wait for all spawned scouts to return.
Do not synthesize partial findings.
Do not fabricate scout results.
Do not poll repeatedly while waiting; results arrive asynchronously.

If a scout fails or times out, retry once.
If a scout returns without useful findings, reformulate the task and spawn a replacement scout.
If a retried or replacement scout still fails, proceed with the findings you have and note the gap for the planner.

## Planner Execution

Call `crew_list` first and verify `planner` is available.

Before spawning the planner:

- remove duplicate scout findings
- drop irrelevant generic observations
- organize findings by area
- preserve specific facts, constraints, paths, interfaces, and conflicts

Spawn the planner with:

- the user's task
- additional instructions or constraints
- relevant user-provided references
- processed scout findings
- project root
- language, framework, dependencies
- relevant conventions
- any discovery gaps

The planner is interactive. It may return:

- Blocking Questions
- Implementation Plan
- No plan needed

## Relay

Do not rewrite subagent output that is already visible as a steering message.

If the planner returns blocking questions:
- ask the user to answer them
- relay the user's response with `crew_respond`
- wait for the next planner response

If the planner returns an implementation plan:
- tell the user the plan is ready and ask for approval or feedback
- relay any feedback with `crew_respond`
- wait for the updated planner response

If the planner returns no plan needed:
- close the planner with `crew_done`
- briefly tell the user no plan is needed and that the task can be implemented directly

If the user approves the plan:
- close the planner with `crew_done`
- confirm that the plan is finalized

## Language

Respond to the user in the same language as the user's request.

## Rules

- Do not investigate deeply yourself; delegate to scouts.
- Do not write, modify, or finalize the plan yourself; use the planner.
- Never answer planner questions on behalf of the user.
- Never fabricate subagent results.
- Always wait for explicit user approval before finalizing the plan.
