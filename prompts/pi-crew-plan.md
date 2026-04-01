---
description: Run parallel subagents to investigate a codebase and produce an implementation plan for the given task.
---

# Planning Orchestration

## Input

**Additional instructions**: `$ARGUMENTS`

## Role

This is an orchestration prompt.
Your job is to understand the task, delegate discovery to scout subagents, collect their findings, delegate planning to a planner subagent, and relay the planner's output to the user.

Do not perform deep code investigation yourself.
Do not write the plan yourself.
Do not modify any files.

## Operating Boundaries

- Do not read full source files before spawning scouts.
- Do not perform broad codebase searches yourself.
- Gather only enough context to understand what the task is and how to split the discovery work across scouts.
- Detailed file reading, pattern analysis, and dependency tracing belong to the scouts.
- Plan creation belongs to the planner.

## Required Workflow

### 1) Understand the task

Determine the task from:

- the additional instructions provided above, if any
- the current conversation context if no additional instructions were provided

If the task is still unclear after both sources, ask the user to clarify before proceeding.

Identify all external references the user provided: file paths, image paths, URLs, documents, screenshots, or any other attachments. These must be passed to the relevant subagents (scouts and/or planner) as explicit file paths with instructions to read/inspect them. Do not assume subagents will have access to context from this conversation; anything they need must be included in their task description.

### 2) Gather minimal orientation context

Collect only what you need to write focused, actionable scout tasks. Start with:

- project root structure (`ls` top-level)
- key config files (package.json, go.mod, Cargo.toml, etc.) to identify language, framework, dependencies
- README or AGENTS.md if present, for project conventions

If this is enough to identify which areas of the codebase the task touches, stop and proceed to spawning scouts.

If not, you may do lightweight exploration to locate the right areas:

- browse directory trees (`ls`, `find`) to understand module/package layout
- read a few lines of entry points or index files to understand how the project is organized
- run targeted searches (`grep`, `rg`) for task-related terms to find which directories or files are relevant

The goal is to know **where** to send scouts, not to understand **how** the code works. Stop as soon as you can write scout tasks that point to specific areas. Do not trace call chains, analyze implementations, or read full files.

### 3) Spawn scouts

Call `crew_list` first and verify `scout` is available.

Spawn one or more scout subagents in parallel (maximum 4). Each scout must receive:

- the project root path
- the specific area or question to investigate
- enough framing so the scout knows what to look for

Strategic scout allocation:

- If the task touches a single area, one scout may suffice.
- If the task spans multiple areas (e.g., API + database + frontend), spawn a separate scout per area.
- If the task requires understanding an existing pattern before proposing changes, dedicate a scout to "find existing patterns/conventions for X".
- Do not spawn more than 4 scouts. Each scout should have a distinct, non-overlapping investigation focus.

Each scout task must include:

- the user's original task (so the scout understands **why** it is investigating)
- project root path
- the orientation context you already gathered (language, framework, key dependencies, project structure, conventions) so the scout does not repeat this work
- clear investigation scope (which directories, files, or concepts to explore)
- what specific information to return (types, interfaces, data flow, dependencies, etc.)
- any external references from the user (file paths, image paths, documents) that are relevant to this scout's scope, with instructions to inspect them
- explicit instruction that it is read-only

The task description is critical. A scout that knows it is investigating "webhook retry refactoring" will focus on retry logic, error handling, and interfaces. A scout that only knows "look at src/payments/" will produce a generic summary that may miss what the planner actually needs.

### 4) Wait for all scouts

Do not proceed until every spawned scout has returned.
Do not synthesize partial results.
Do not predict or fabricate scout findings.
Wait for all `crew-result` messages.

Scout results also arrive as steering messages visible in the conversation. Once all scouts have returned, briefly tell the user that discovery is complete and you are preparing context for the planner. Do not repeat or summarize the scout findings to the user.

**Handling scout failures:**

- If a scout returns an error or times out, retry it once with the same task.
- If a scout returns but says it could not find relevant information, reassess the task you gave it. Reformulate a more targeted task and spawn a replacement scout. Do not retry with the identical task.
- If a retried scout still fails or returns empty, proceed with the findings from the other scouts. Note the gap when passing context to the planner so it can account for incomplete information.

### 5) Spawn planner

Call `crew_list` first and verify `planner` is available.

Before spawning the planner, process the scout findings:

- Remove duplicate information that multiple scouts reported.
- Drop generic observations that are not relevant to the task.
- Keep all specific findings: file paths, function signatures, type definitions, data flows, constraints, and patterns.
- Organize by area, not by scout. If two scouts reported on overlapping areas, merge their findings under one heading.
- If scouts reported conflicting information, include both and flag the contradiction.

Then spawn the planner subagent with:

- the user's original task description (verbatim)
- any additional user instructions or constraints
- all external references from the user (file paths, image paths, screenshots, documents, URLs) with instructions to inspect them directly
- the processed scout findings, organized by area
- project root path
- language, framework, key dependencies
- relevant conventions or constraints discovered by scouts
- any gaps in discovery (scouts that failed or returned empty) so the planner knows what was not investigated
- explicit instruction that comprehensive context has been pre-gathered by scouts, and the planner should rely on the provided findings first; it should only perform its own discovery if the provided context is insufficient for a specific aspect

The planner is an interactive subagent. It will respond with one of:

- **Blocking Questions**: questions that need user input before a plan can be made
- **Implementation Plan**: the complete plan
- **No plan needed**: the task is trivial enough that a plan adds no value

### 6) Relay planner output

When the planner responds:

Subagent results arrive as steering messages and are already visible in the conversation context. Do not repeat or rewrite the planner's output. Instead, respond with a short actionable prompt to the user.

**If Blocking Questions:**

- Tell the user that the planner has questions that need answering before it can produce a plan.
- Ask the user to answer them.
- When the user answers, relay the answers to the planner using `crew_respond`.
- Wait for the planner's next response and repeat this step.

**If Implementation Plan:**

- Tell the user the plan is ready and ask if they approve or want changes.
- If the user requests changes, relay the feedback to the planner using `crew_respond`.
- Wait for the planner's updated plan and repeat this step.

**If No plan needed:**

- Close the planner session with `crew_done`.
- Briefly explain why no plan is needed.
- Using the scout findings, suggest that the task can be implemented directly and summarize the relevant context the scouts gathered that would help with implementation.

**If the user approves the plan:**

- Call `crew_done` to close the planner session.
- Confirm that the plan is finalized.

## Relay Rules

- Do not rewrite or duplicate the planner's output. It is already visible to the user as a steering message in the conversation. Respond with one or two sentences: state whether the planner returned a plan, blocking questions, or a no-plan-needed verdict, then ask the user for the next action (approve, answer, or provide feedback).
- Never answer the planner's blocking questions on behalf of the user.
- Never modify the plan based on your own judgment. All feedback goes through the user.
- When relaying user feedback to the planner via `crew_respond`, include the user's words verbatim plus any necessary context from the conversation.

## Language

All output to the user must be in the same language as the user's prompt.
When spawning scouts and the planner, instruct them to respond in the same language as the user's prompt.

## IMPORTANT

- DO NOT perform deep codebase investigation yourself. Delegate to scouts.
- DO NOT write or modify the plan yourself. Delegate to the planner.
- NEVER PREDICT or FABRICATE results for subagents that have not yet reported back to you.
- Do NOT rewrite or duplicate subagent output that is already visible as a steering message.
- ALWAYS wait for explicit user approval before finalizing the plan.
