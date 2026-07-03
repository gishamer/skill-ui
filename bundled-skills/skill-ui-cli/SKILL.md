---
name: skill-ui-cli
description: Use when an agent or desktop AI client needs to discover, install, update, validate, upload, or publish shared agent skills through the Skill UI CLI without handling GitHub repository URLs, tokens, or auth plumbing directly.
version: 1.0.0
author: Skill UI
license: MIT
metadata:
  hermes:
    tags: [skill-ui, skills, cli, agents, github, skill-management]
    related_skills: []
---

# Skill UI CLI

## Overview

Skill UI is the one-stop-shop for shared agent skills. Its desktop app gives humans a friendly interface for browsing, installing, creating, editing, and publishing skills. Its CLI gives agents the same capabilities through one stable command: `skill-ui`.

Use the CLI when you need to work with skills but should not make assumptions about GitHub owners, repository names, branches, paths, or access tokens. The CLI resolves the same configuration and credentials as the Skill UI app, including the encrypted desktop token where available.

The goal is simple: clients such as Hermes, Claude Desktop, Claude Code, or other agent runtimes can manage skills with `skill-ui` instead of manually using GitHub APIs, cloning repositories, or asking the user for token details.

## When to Use

Use this skill when the user asks you to:

- Learn which shared skills are available.
- Install a shared skill into Hermes, Claude Desktop, or another local skills directory.
- Download a skill bundle for inspection or editing.
- Validate a locally authored skill before publishing it.
- Upload a new skill to the shared repository as a pull request.
- Update an existing shared skill by opening a pull request.
- Synchronize local installed skills with the shared repository.
- Troubleshoot Skill UI CLI auth, repository configuration, or install targets.

Do not use this skill for:

- Editing a skill directly in a GitHub repository when the CLI can perform the workflow.
- Hard-coding a private repository URL or token into instructions.
- Installing arbitrary files that are not valid `SKILL.md` skill folders.

## Mental Model

A skill is a folder containing a root `SKILL.md` file. It may also include support folders such as `references/`, `scripts/`, `templates/`, and `assets/`. Skill UI preserves whole folders; do not assume a skill is only one markdown file.

Skill UI has three places where skills may exist:

1. **Bundled/default skills** — shipped with Skill UI itself. These should always be listable and installable, even before a shared repository is connected. `skill-ui-cli` is one of these skills.
2. **Shared repository skills** — skills published to the configured GitHub repository. Skill UI opens pull requests when adding or updating these.
3. **Local installed skills** — copies installed into client directories such as `~/.hermes/skills`, `~/.claude/skills`, or a custom directory.

## Command Reference

Run this first whenever you are unsure:

```bash
skill-ui --help
```

### Check configuration

```bash
skill-ui config get
skill-ui config get --json
```

Use this to learn the configured repository, branch, skills path, custom install directory, and token source. Token values are redacted.

### Check authentication

```bash
skill-ui auth status
skill-ui auth status --json
```

Expected success looks like one of:

```text
Authenticated via Skill UI desktop encrypted token.
Authenticated via $SKILL_UI_TOKEN.
Authenticated via gh auth token.
```

If auth fails, prefer asking the user to open Skill UI Settings and save/test a GitHub token, or to run `gh auth login`. Do not ask for a token in chat unless there is no safer path.

### List available skills

```bash
skill-ui list
skill-ui list --json
```

Use `--json` when another agent or script needs structured output. Each item includes at least:

- `name`
- `description`
- `version`
- `repoPath`

Bundled/default skills may use a `repoPath` such as `builtin/skill-ui-cli`.

### Read a skill bundle

```bash
skill-ui read <skill-name-or-repo-path>
skill-ui read <skill-name-or-repo-path> --json
```

This prints a full skill bundle with metadata and all files. Use it when you need to inspect instructions before installing, compare content, or prepare an edit.

### Install or download a skill

```bash
skill-ui download <skill-name-or-repo-path> --target ~/.hermes/skills
skill-ui download <skill-name-or-repo-path> --target ~/.claude/skills
skill-ui download <skill-name-or-repo-path> --target /path/to/custom/skills
skill-ui download <skill-name-or-repo-path> --target ~/.hermes/skills --json
```

Despite the name `download`, this command installs the skill folder under the target skills directory. For example:

```bash
skill-ui download skill-ui-cli --target ~/.hermes/skills
```

creates:

```text
~/.hermes/skills/skill-ui-cli/SKILL.md
```

If the target directory does not exist, the CLI should create the needed folders.

### Validate a local skill

```bash
skill-ui validate ./my-skill
skill-ui validate ./my-skill --json
```

Run validation before upload/update. A valid skill must have:

- folder name matching the skill name;
- root `SKILL.md`;
- YAML frontmatter starting at byte 0;
- non-empty `name` and `description` fields;
- Markdown body after frontmatter;
- safe relative file paths.

### Upload a new skill

```bash
skill-ui upload ./my-skill --note "Initial version"
skill-ui upload ./my-skill --dry-run --json
```

Use `--dry-run` first when possible. A real upload validates the local folder, commits the skill files to a branch, and opens a pull request against the configured repository.

### Update an existing shared skill

```bash
skill-ui update ./my-skill --note "Improve install guidance"
skill-ui update ./my-skill --dry-run --json
```

Use this when the user has edited a local copy of an existing shared skill and wants to publish the changes for review.

## Standard Agent Workflows

### Discover and install a needed skill

1. List available skills:

   ```bash
   skill-ui list --json
   ```

2. Select the best skill by name and description.
3. Install it into the active client directory:

   ```bash
   skill-ui download <name> --target ~/.hermes/skills
   ```

4. Tell the user where it was installed.
5. If the host client only loads skills at startup, tell the user to restart or reload the client.

### Install the default Skill UI CLI skill

For Hermes:

```bash
skill-ui download skill-ui-cli --target ~/.hermes/skills
```

For Claude Desktop or Claude Code using the default Claude skills directory:

```bash
skill-ui download skill-ui-cli --target ~/.claude/skills
```

For another client:

```bash
skill-ui download skill-ui-cli --target /path/to/client/skills
```

This gives the client persistent instructions for using `skill-ui` in future sessions.

### Create and publish a new skill

1. Create a folder whose name is the intended skill slug:

   ```text
   my-skill/
   └── SKILL.md
   ```

2. Write complete YAML frontmatter and instructions.
3. Validate locally:

   ```bash
   skill-ui validate ./my-skill
   ```

4. Dry-run upload:

   ```bash
   skill-ui upload ./my-skill --dry-run --json
   ```

5. Upload as a pull request:

   ```bash
   skill-ui upload ./my-skill --note "Describe the purpose of this skill"
   ```

6. Report the PR URL and branch returned by the CLI.

### Update a skill from local edits

1. Read or install the current shared skill if needed:

   ```bash
   skill-ui read <name> --json
   skill-ui download <name> --target /tmp/skill-edit
   ```

2. Edit the local skill folder.
3. Validate:

   ```bash
   skill-ui validate ./skill-folder
   ```

4. Dry-run update:

   ```bash
   skill-ui update ./skill-folder --dry-run --json
   ```

5. Open a pull request:

   ```bash
   skill-ui update ./skill-folder --note "Summarize the changes"
   ```

### Acquire a skill without knowing the repository

Do not use `git clone`, `gh repo clone`, or raw GitHub URLs just to acquire a skill. Prefer:

```bash
skill-ui list --json
skill-ui download <name> --target <client-skills-dir>
```

The CLI already knows the configured repository and credentials.

## Install Targets

Common default targets:

| Client | Target directory |
| --- | --- |
| Hermes | `~/.hermes/skills` |
| Claude Desktop / Claude Code | `~/.claude/skills` |
| Custom client | the directory configured or documented by that client |

If the user has a custom Skill UI target configured, inspect it with:

```bash
skill-ui config get --json
```

Then use `customSkillsDir` if appropriate.

## Output Handling

Prefer `--json` for agent-to-tool workflows. Human-readable output is useful in summaries, but JSON is easier to parse safely.

Successful commands generally return enough information to verify the action:

- `list --json`: array of available skills.
- `read --json`: skill metadata and file list/content.
- `download --json`: install path and skill metadata.
- `validate --json`: validity and errors.
- `upload/update --json`: PR URL, PR number, and branch when a real PR is opened.

Do not claim success unless the command exits with status 0 and the returned data matches the requested action.

## Auth and Repository Behavior

The CLI should hide credential and repository details from agents. It resolves auth in this order:

1. CLI config token from `~/.skill-ui/config.json`.
2. Environment variables such as `SKILL_UI_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`.
3. The encrypted Skill UI desktop token via Electron safeStorage.
4. `gh auth token` as a fallback.

This matters on machines where the terminal GitHub account cannot access the skill repository but the Skill UI app can. In that case, `skill-ui auth status` should report the desktop encrypted token, and repository operations should still work.

## Troubleshooting

### `skill-ui` command not found

Try running from the Skill UI project with:

```bash
node bin/skill-ui.js --help
```

If installed from npm or a packaged release, ensure the package binary is on `PATH`.

### Cannot load private repository

Run:

```bash
skill-ui auth status
skill-ui config get --json
```

If auth falls back to `gh auth token` and that account lacks access, open the Skill UI desktop app, save a token in Settings, and test the connection there. Then retry the CLI.

### Skill validates in one client but not another

Use the Skill UI validator as the source of truth before publishing:

```bash
skill-ui validate ./skill-folder --json
```

Fix all reported errors before upload.

### Installed skill does not appear in the client

Check:

1. The target directory was correct.
2. The skill folder contains a root `SKILL.md`.
3. The client supports skills from that directory.
4. The client was restarted or reloaded if it only discovers skills on startup.

### Upload or update cannot create a PR

The CLI may validate and push changes but still fail to create a PR if the token lacks pull-request permissions. Use the returned branch or compare URL if provided, or ask the user to grant GitHub Pull requests: Read and write permission to the token.

## Safety Rules

- Never print or store tokens in skill content or chat summaries.
- Prefer `--dry-run` before `upload` or `update`.
- Validate before publishing.
- Preserve support folders; do not flatten a multi-file skill into one markdown file.
- Do not overwrite a user's local skill unless they asked to install/update it.
- When installing, report the exact target directory.
- When publishing, report the PR URL and branch.

## Verification Checklist

Before telling the user a Skill UI CLI operation succeeded, verify:

- [ ] `skill-ui auth status` succeeds when repository access is needed.
- [ ] `skill-ui config get --json` points to the expected repository or an intentional override.
- [ ] `skill-ui list --json` includes the target skill before install/read.
- [ ] `skill-ui download ... --json` returns the installed directory for installs.
- [ ] `skill-ui validate ...` passes before upload/update.
- [ ] `skill-ui upload/update ...` returns a PR URL for publishing workflows.
- [ ] The installed skill path exists on disk when local installation was requested.
