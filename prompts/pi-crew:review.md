---
description: Run parallel code and quality reviews to ensure high standards and catch issues early.
---

# Parallel Review

## Input

**Additional instructions**: `$ARGUMENTS`

## Role

This is an orchestration prompt.
Your job is to determine review scope with minimal context gathering, prepare a short review brief, spawn the reviewer subagents, wait for both results, and merge them into one final report.

Do not do the reviewers' job.

## Operating Boundaries

- Do not read full files before spawning subagents.
- Do not dump raw diffs into the prompt.
- Do not inspect every changed file manually.
- Collect only enough git context to determine scope and produce a short summary.
- Detailed diff reading, file reading, and issue analysis belong to the subagents.
- Use targeted extra reads only when file names and diff stats are insufficient.

## Required Workflow

### 1) Determine scope

Default scope, unless the user specifies otherwise:

- recent commits
- staged changes
- unstaged changes
- untracked files

Collect:

- repo root
- current branch
- `git status --short`
- `git log --oneline --decorate -n 5`
- `git diff --stat --cached`
- `git diff --stat`
- untracked file list

Do not collect full diffs by default.
Use `git diff --cached` or `git diff` only if diff stats and file names are insufficient.

Recent commit range:

- use `HEAD~3..HEAD` if at least 3 commits exist
- otherwise use the widest reachable history range

For that range, collect:

- `git diff --stat <range>`
- `git diff --name-only <range>`

Use `git diff <range>` only if needed for a short summary.

If the user gives a commit, branch, file, or extra focus area, include it as additional context.

### 2) Prepare subagent context

Prepare a short brief with:

- review scope
- commit range
- staged/unstaged/untracked state
- changed files
- one-line summary per file or file group
- additional user instructions

Summary rules:

- infer first from file paths, status codes, and diff stats
- read only specific files or hunks if needed
- keep it short
- do not perform review analysis here

### 3) Spawn reviewers

Call `crew_list` first and verify:

- `code-reviewer`
- `quality-reviewer`

Spawn both in parallel.
Each task must include:

- repo root
- review scope
- commit range
- staged/unstaged/untracked info
- changed files
- short change summary
- user instructions
- explicit instruction to inspect diffs and files itself
- explicit instruction to follow its own output format strictly

### 4) Wait

Do not produce a final response until both subagents return.
Do not synthesize partial results.
Wait for two separate `crew-result` messages.

### 5) Merge reports

Final output must be in the same language as the user's prompt.
Use the structure below directly. Do not read any subagent definition files just to reconstruct the format.

Order:

#### A. Consensus Findings

**[SEVERITY] Category: Brief title**
File: `path/to/file.ts:123` or `path/to/file.ts` (section)
Issue: Clear merged explanation
Context/Impact: Runtime or maintenance impact
Suggestion: Clear fix direction
Reported by: `code-reviewer`, `quality-reviewer`

Rules:

- do not repeat the same issue
- merge equivalent findings
- if needed, use the stronger justified severity

#### B. Code Review Findings

**[SEVERITY] Category: Brief title**
File: `path/to/file.ts:123`
Issue: ...
Context: ...
Suggestion: ...
Reported by: `code-reviewer`

#### C. Quality Review Findings

**[SEVERITY] Category: Brief title**
File: `path/to/file.ts` (functionName or section, line range if identifiable)
Issue: ...
Impact: ...
Suggestion: ...
Reported by: `quality-reviewer`

#### D. Final Summary

**Combined Review Summary**
Files reviewed: [count or list]
Consensus findings: [count]
Code review findings: [count by severity]
Quality review findings: [count by severity]
Strong signals: [titles found by both reviewers or `none`]
Overall assessment: [short clear assessment]

## Synthesis Rules

- do not repeat overlapping issues
- merge close variants into one item
- do not invent resolution for reviewer conflicts
- if both say `No issues found.`, say so explicitly
- if only one reviewer reports an issue, do not present it as consensus
- sort by severity
- no unnecessary introduction
- review only, no code changes
