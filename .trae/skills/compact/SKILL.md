---
name: "compact"
description: "Compresses project context, summarizes progress, and archives outdated tasks. Invoke when user says 'compact' or wants to tidy up the session/project state."
---

# Compact Skill

This skill is designed to "tidy up" the current project state, making it cleaner and more focused.

## What it does

1.  **Summarize & Archive**: It reviews the current `todo` list, archives completed tasks, and consolidates pending ones.
2.  **Context Compression**: It summarizes key architectural decisions or changes made recently into `manage_core_memory` (if not already done).
3.  **Cleanup**: It identifies and suggests removing temporary files or unused code blocks if explicitly asked.

## How to use

When the user invokes `compact`, follow these steps:

1.  **Check Todos**:
    - Read the current todo list using `TodoWrite` (implied or via tool history).
    - If there are many completed tasks, use `TodoWrite` with `merge=false` to rewrite the list, keeping only `in_progress` and `pending` tasks, and summarizing the completed ones into a single "Archived/Completed" note in your final response (or a memory entry).

2.  **Consolidate Memory**:
    - If there have been significant architectural changes (e.g., "AI Decision Center", "Project-Centric Execution"), ensure they are recorded in Core Memory via `manage_core_memory`.
    - If there are redundant memories, merge them.

3.  **Report**:
    - Output a concise summary of what was "compacted" (e.g., "Archived 5 completed tasks, consolidated AI architecture rules into memory, and cleaned up the active task list.").

## Example Action

If the user has 10 completed tasks and 2 pending:
- **Action**: Rewrite the todo list to only show the 2 pending tasks.
- **Response**: "I've archived 10 completed tasks. Current focus: [Task A, Task B]."
