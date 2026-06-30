# Obsidian TileLineBase GitHub PR handoff

Source: {{source}}
Repository: {{repository}}
PR: #{{number}} {{title}}
Branch: {{headRefName}} -> {{baseRefName}}
Author: {{author}}
URL: {{url}}
Check signal: {{failingChecks}}
Workspace: {{workspace}}

This is a desktop handoff notification for an Obsidian TileLineBase pull request signal.

Do not run tools or change files yet. First reply with a concise triage note that names the PR, the check signal, and says the next investigation should start with `gh pr view {{number}} --repo {{repository}} --json number,title,headRefName,baseRefName,isDraft,author,url,statusCheckRollup` and `gh pr checks {{number}} --repo {{repository}} --json name,state,bucket,workflow,link,description`. Wait for the user to take over the thread before inspecting, repairing, committing, or pushing.
