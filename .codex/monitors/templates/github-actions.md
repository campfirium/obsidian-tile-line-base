# Obsidian TileLineBase GitHub Actions handoff

Source: {{source}}
Repository: {{repository}}
Workflow: {{workflow}}
Branch: {{branch}}
Run: {{runId}}
Commit: {{headSha}}
Title: {{runTitle}}
URL: {{url}}
Workspace: {{workspace}}

This is a desktop handoff notification for an Obsidian TileLineBase GitHub Actions failure.

Do not run tools or change files yet. First reply with a concise triage note that names the failed workflow, links the run, and says the next investigation should start with `gh run view {{runId}} --repo {{repository}} --json jobs,conclusion,headBranch,headSha,displayTitle` plus the failed job log. Wait for the user to take over the thread before inspecting, repairing, committing, or pushing.
