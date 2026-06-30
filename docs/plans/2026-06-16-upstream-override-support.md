# Upstream Override Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a configurable upstream override mechanism via `.upstream.json` for Git repositories scanned by the swarm's upstream sync scheduled job, and apply it to the `whispercode` repository to point directly to the original OpenCode repository.

**Architecture:** 
Introduce support for a `.upstream.json` configuration file in repository roots containing the upstream Git URL and default branch name. Update the synchronization scanner, helper scripts, and scheduler prompts in the `agent-swarm-orchestrator` project to fetch directly from this override URL (using `FETCH_HEAD` for comparison) rather than relying exclusively on local directory remotes.

**Tech Stack:** Python, Git, JSON

---

### Task 1: Create `.upstream.json` in the `whispercode` repository

**Files:**
- Create: `/Users/isaac/Projects/whispercode/.upstream.json`

- [ ] **Step 1: Write `.upstream.json`**
  Write a JSON configuration file containing the original OpenCode repository URL and the target branch (`dev`).
  
  ```json
  {
    "url": "git@github.com:anomalyco/opencode.git",
    "default_branch": "dev"
  }
  ```

- [ ] **Step 2: Commit**
  Stage and commit the new file in the `whispercode` repository.
  
  ```bash
  git add .upstream.json
  git commit -m "chore: add upstream override configuration pointing to original opencode"
  ```

---

### Task 2: Update `upstream_sync_check.py` to support `.upstream.json` overrides

**Files:**
- Modify: `/Users/isaac/Projects/agent-swarm-orchestrator/scripts/upstream_sync_check.py`

- [ ] **Step 1: Modify the script to detect and parse `.upstream.json`**
  Modify `/Users/isaac/Projects/agent-swarm-orchestrator/scripts/upstream_sync_check.py` to check for `.upstream.json`, fetch from the override URL if present, and compare using `FETCH_HEAD`.
  
  Replace the remote detection, fetching, and diff-checking blocks. Here is the full updated section:
  
  ```python
          # Check for .upstream.json configuration override
          config_path = repo / ".upstream.json"
          upstream_url = remotes.get('upstream')
          default_branch = None
          has_upstream = 'upstream' in remotes
          has_override = False
          
          if config_path.exists():
              try:
                  with open(config_path, "r") as f:
                      config = json.load(f)
                      if config.get("url"):
                          upstream_url = config.get("url")
                          has_upstream = True
                          has_override = True
                      if config.get("default_branch"):
                          default_branch = config.get("default_branch")
              except Exception as e:
                  print(f"Error reading .upstream.json in {repo_name}: {e}")
          
          report_repo = {
              "name": repo_name,
              "path": str(repo),
              "origin": origin_url,
              "upstream": upstream_url,
              "has_upstream": has_upstream,
              "fetched": False,
              "diff_summary": "",
              "recommendation": "No action required",
              "merge_commands": []
          }
          
          if has_upstream:
              print(f"Found upstream: {upstream_url}")
              # Fetch upstream changes
              if has_override:
                  if default_branch:
                      fetch_res = run_cmd(['git', 'fetch', upstream_url, default_branch], cwd=str(repo))
                  else:
                      fetch_res = run_cmd(['git', 'fetch', upstream_url], cwd=str(repo))
              else:
                  fetch_res = run_cmd(['git', 'fetch', 'upstream'], cwd=str(repo))
                  
              if fetch_res is not None:
                  report_repo["fetched"] = True
                  
                  main_branch = None
                  if has_override:
                      main_branch = "FETCH_HEAD"
                  else:
                      # Determine upstream branch name
                      branches_raw = run_cmd(['git', 'branch', '-r'], cwd=str(repo))
                      upstream_branches = []
                      if branches_raw:
                          upstream_branches = [b.strip() for b in branches_raw.split('\n') if b.strip().startswith('upstream/')]
                      
                      for b in ['upstream/main', 'upstream/master']:
                          if b in upstream_branches:
                              main_branch = b
                              break
                      
                      if not main_branch and upstream_branches:
                          main_branch = upstream_branches[0] # Fallback
                  
                  if main_branch:
                      # Run git log and git diff
                      log_diff = run_cmd(['git', 'log', f'HEAD..{main_branch}', '--oneline', '-n', '20'], cwd=str(repo))
                      diff_stat = run_cmd(['git', 'diff', f'HEAD..{main_branch}', '--stat'], cwd=str(repo))
                      
                      report_repo["diff_summary"] = f"Commits behind upstream:\n{log_diff}\n\nDiff Stat:\n{diff_stat}"
                      
                      # Assess recommendation
                      if log_diff:
                          keywords = ['fix', 'security', 'vuln', 'cve', 'bug', 'patch', 'feat', 'update']
                          has_important = any(kw in log_diff.lower() for kw in keywords)
                          
                          if has_important:
                              report_repo["recommendation"] = "Merge recommended (contains bug fixes/features/security updates)"
                          else:
                              report_repo["recommendation"] = "Merge optional (minor changes)"
                              
                          # Build merge commands
                          local_branch = run_cmd(['git', 'branch', '--show-current'], cwd=str(repo)) or "main"
                          if has_override:
                              report_repo["merge_commands"] = [
                                  f"git checkout {local_branch}",
                                  f"git fetch {upstream_url} {default_branch or ''}".strip(),
                                  f"git merge FETCH_HEAD"
                              ]
                          else:
                              report_repo["merge_commands"] = [
                                  f"git checkout {local_branch}",
                                  f"git fetch upstream",
                                  f"git merge {main_branch}"
                              ]
                      else:
                          report_repo["recommendation"] = "Up to date - No merge needed"
  ```

- [ ] **Step 2: Commit changes to script**
  Change directory to `/Users/isaac/Projects/agent-swarm-orchestrator` and commit the updated script.
  
  ```bash
  git add scripts/upstream_sync_check.py
  git commit -m "feat(sync): support .upstream.json configuration override in upstream_sync_check.py"
  ```

---

### Task 3: Update `test_find_forks.py` to support `.upstream.json` overrides

**Files:**
- Modify: `/Users/isaac/Projects/agent-swarm-orchestrator/scripts/test_find_forks.py`

- [ ] **Step 1: Update fork detection logic**
  Modify `/Users/isaac/Projects/agent-swarm-orchestrator/scripts/test_find_forks.py` to check for `.upstream.json` first, and print/add it to the list of forks if found.
  
  Replace the project checking loop. Here is the updated code block:
  
  ```python
      forks = []
      for proj in projects:
          if proj in ["swarm_workspace", "cache"]:
              continue
              
          # Check for .upstream.json first
          upstream_json_path = f"{parent_dir}/{proj}/.upstream.json"
          if os.path.exists(upstream_json_path):
              try:
                  with open(upstream_json_path, "r") as f:
                      config = json.load(f)
                      upstream_url = config.get("url", "Unknown")
                      forks.append((proj, upstream_url))
                      print(f"Found fork (via .upstream.json): {proj} -> {upstream_url}")
                      continue
              except Exception as e:
                  pass
  
          # Read .git/config using symlink
          config_path = f"{parent_dir}/{proj}/.git/config"
          symlink_name = f"config-{proj}"
  ```

- [ ] **Step 2: Commit script updates**
  Commit the updated file in `agent-swarm-orchestrator`.
  
  ```bash
  git add scripts/test_find_forks.py
  git commit -m "feat(sync): support .upstream.json override detection in test_find_forks.py"
  ```

---

### Task 4: Update `run_fork_sync.py` subtask prompt

**Files:**
- Modify: `/Users/isaac/Projects/agent-swarm-orchestrator/scripts/run_fork_sync.py`

- [ ] **Step 1: Modify the subtask prompt text**
  Update the hardcoded instructions prompt in `/Users/isaac/Projects/agent-swarm-orchestrator/scripts/run_fork_sync.py` to instruct the developer subagent to handle `.upstream.json` overrides.
  
  Replace the prompt definition:
  
  ```python
      prompt = """This is task-agent-swarm-orchestrator-1781331033190611118's subtask.
  We need to analyze the upstream sync status of this repository ('whispercode').
  Please perform the following operations in this repository:
  1. Check if there is a `.upstream.json` configuration file in the repository root. If present, parse it to find the upstream URL and default branch. Otherwise, fall back to identifying the 'upstream' remote URL.
  2. Fetch the latest changes from upstream: if using `.upstream.json`, run `git fetch <upstream_url> <default_branch>` (or `git fetch <upstream_url>` if default branch is not specified); otherwise run `git fetch upstream`.
  3. Determine the upstream target commit/branch (e.g. `FETCH_HEAD` if using `.upstream.json` URL fetch, or the upstream remote tracking branch like `upstream/main`, `upstream/master` otherwise).
  4. Determine the local default branch (e.g. dev, main, master).
  5. Compare the upstream target commit/branch with the local default branch. Check if there are any new commits in the upstream default branch that are not present locally.
  6. Retrieve the commit log and git diff stats for any new commits.
  7. Generate a markdown report in your results directory (as an artifact) detailing:
     - Upstream URL and remote branch.
     - Status (up-to-date or behind by N commits).
     - List of new commits (hash, author, date, message).
     - Analysis of changes (identifying bug fixes, security updates, features).
     - Your recommendation on whether to merge.
     - Exact git commands to merge.
  8. Output the final markdown report to a file named 'sync_analysis.md' in the task results.
  """
  ```

- [ ] **Step 2: Commit script updates**
  Commit the updated file in `agent-swarm-orchestrator`.
  
  ```bash
  git add scripts/run_fork_sync.py
  git commit -m "feat(sync): support .upstream.json overrides in run_fork_sync.py subtask prompt"
  ```

---

### Task 5: Update scheduled job configuration in `schedule_config.json`

**Files:**
- Modify: `/Users/isaac/Projects/project.vault/My Projects/agent-swarm-orchestrator/conductor/schedule_config.json`

- [ ] **Step 1: Update schedule prompt and profile**
  Modify the `prompt` and `profile` keys of the job with `"id": "sched-upstream-forks-sync"` inside `schedule_config.json` to instruct the agent to support `.upstream.json` overrides and to switch the execution profile to `agy-conductor-brain.json` (which enables network/internet access to fetch from remote GitHub repositories).
  
  Update the `"profile"` value to `"agy-conductor-brain.json"`.
  
  Update the `"prompt"` JSON value to:
  
  ```json
  "Scan all subdirectories under /Users/isaac/Projects/ (except swarm_workspace and cache) to identify which ones are Git repositories that either have an 'upstream' remote configured or contain a `.upstream.json` configuration file (meaning they are upstream forks). For each repository identified as a fork:\n1. Identify the upstream URL (either from `.upstream.json` or the 'upstream' remote). Run a fetch on that URL/remote to pull the latest changes.\n2. Determine the upstream default branch (e.g., from `.upstream.json` or by checking the remote tracking branches of 'upstream') and compare it with the local default branch.\n3. Analyze the new commits/diffs to assess whether they are worth merging (e.g., checking for bug fixes, security updates, feature additions).\n4. Generate a unified markdown report summarizing the sync status of all scanned forks, including your recommendation on whether to merge and the exact git commands needed to perform the merge.\nSave this unified report directly to /Users/isaac/Projects/agent-swarm-orchestrator/vault/🧠 Conductor/📂 analytics/upstream_sync_report.md."
  ```

---

### Task 6: Verify implementation

- [ ] **Step 1: Run sync check script locally**
  Run the script in the context of the workspace to verify it parses `.upstream.json` correctly and fetches from GitHub.
  
  Run:
  ```bash
  python3 /Users/isaac/Projects/agent-swarm-orchestrator/scripts/upstream_sync_check.py
  ```
  Expected: Script runs successfully and writes the sync status of `whispercode` pointing to the GitHub OpenCode repository, showing the new status/diffs in `upstream_sync_report.md`.
