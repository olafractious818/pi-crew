---
description: Run parallel code and quality reviews by gathering minimal context and orchestrating reviewer subagents.
---

# Parallel Review

## Input

**Additional instructions**: `$ARGUMENTS`

## Role

This is an orchestration prompt.
Determine review scope with minimal context gathering, prepare a short neutral brief, spawn the reviewer subagents, wait for their results, and merge them into one final report.

Do not perform the review yourself.

## Scope Rules

- If the user specifies a scope (commit, branch, files, PR, or focus area), that scope overrides the default scope.
- Otherwise, default scope includes:
  - recent commits
  - staged changes
  - unstaged changes
  - untracked files

## Context Gathering

Collect only enough context to define scope and prepare a short brief.

Collect:

- repo root
- current branch
- `git status --short`
- `git log --oneline --decorate -n 5`
- `git diff --stat --cached`
- `git diff --stat`
- untracked file list

For recent commits:

- use `HEAD~3..HEAD` if at least 3 commits exist
- otherwise use the widest reachable history range

Collect for that range:

- `git diff --stat <range>`
- `git diff --name-only <range>`

Rules:

- Do not read full files before spawning subagents.
- Do not dump raw diffs into the prompt.
- Do not inspect every changed file manually.
- Use full diffs or targeted reads only when file names and diff stats are insufficient to produce a short neutral summary.
- Keep the brief short and descriptive, not analytical.

## Subagent Preparation

Call `crew_list` first and verify that both are available:

- `code-reviewer`
- `quality-reviewer`

Prepare one short brief for both reviewers including:

- repo root
- resolved review scope
- commit range if any
- staged / unstaged / untracked status
- changed files
- short summary per file or file group
- additional user instructions

## Execution

Spawn `code-reviewer` and `quality-reviewer` in parallel.

If one reviewer is unavailable or fails to start, report that clearly and continue with the reviewer that is available.

Do not produce a final report until all successfully spawned reviewers have returned a result.
Do not poll or repeatedly check active subagents while waiting; results will be delivered asynchronously.

## Merge

Write the final response in the same language as the user's request.

Structure:

### Consensus Findings

Merge only findings that are clearly the same issue reported by both reviewers.

### Code Review Findings

Include findings reported only by `code-reviewer`.

### Quality Review Findings

Include findings reported only by `quality-reviewer`.

### Final Summary

Include:

- review scope
- which reviewers ran
- consensus findings count
- code review findings count
- quality review findings count
- overall assessment

Rules:

- Do not repeat overlapping findings.
- Do not invent reviewer output, evidence, or counts.
- Do not present a single-reviewer finding as consensus.
- If both reviewers report no issues, say so explicitly.
- If one reviewer failed or was unavailable, say so explicitly.
- Review only. Do not make code changes.
- Do not analyze code, infer issues, or produce findings yourself. Only orchestrate reviewers and merge their reported results.
- Never fabricate subagent results. Wait for all successfully spawned reviewers to return.
