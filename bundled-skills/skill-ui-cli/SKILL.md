---
name: skill-ui-cli
description: Use when an agent or desktop AI client needs to discover/list available skills, compare descriptions to the current task, install relevant skills, scaffold, validate, mirror, upload, or update full shared agent skill bundles through the Skill UI CLI without handling GitHub repository URLs, tokens, or auth plumbing directly.
version: 1.1.0
author: Skill UI
license: MIT
metadata:
  hermes:
    tags: [skill-ui, skills, cli, agents, github, skill-management]
    related_skills: []
---

# Skill UI CLI

## Overview

Skill UI is the one-stop-shop for shared agent skills. The desktop app gives humans a friendly interface for browsing, installing, creating, editing, and publishing skills. The CLI gives agents the same core workflows through one command: `skill-ui`.

Use this skill when you need to manage skills without guessing GitHub owners, repository names, branches, paths, local checkout directories, install targets, or tokens. The CLI resolves the same repository settings and credentials as the Skill UI app, including repository JSON config and the encrypted desktop token when available.

A skill is a folder containing a root `SKILL.md`. It may also include support files and folders such as `CHANGELOG.md`, `references/`, `scripts/`, `templates/`, and `assets/`. Skill UI preserves full skill bundles. Do not flatten a multi-file skill into only `SKILL.md`.

## When to use

Use this skill when the user asks you to:

- discover/list available shared skills and compare their descriptions to the current task;
- install a skill into Hermes, Claude, Copilot, or another skills directory;
- scaffold a new governed skill with metadata defaults;
- validate a local skill folder before publishing;
- import or mirror a remote GitHub skill for review;
- upload a new local skill as a pull request;
- update an existing shared skill from local edits;
- check Skill UI repository configuration, client targets, or auth state;
- troubleshoot Skill UI CLI install, repository, or pull-request workflows.

Do not use this skill for:

- hard-coding private repository URLs or tokens;
- manually cloning GitHub just to install/read a skill that `skill-ui` can resolve;
- installing arbitrary folders that are not valid skill bundles.

## First command

Run this when unsure:

```bash
skill-ui --help
```

Prefer `--json` whenever another agent or script consumes the output.

## Configuration and auth

### Show resolved config

```bash
skill-ui config get --json
```

This reports the resolved repository owner/name/branch/skills path, local checkout, repo config path, custom install directory, configured clients, skill defaults, repository conventions, and token status. Tokens are redacted.

Skill UI can read repository config from:

- desktop settings;
- CLI config at `~/.skill-ui/config.json`;
- `--config /path/to/skill-ui.config.json`;
- `SKILL_UI_REPO_CONFIG`;
- `skill-ui.config.json` or `.skill-ui.json` in the configured local checkout.

Set local CLI overrides with:

```bash
skill-ui config set repoOwner your-org
skill-ui config set repoName skills
skill-ui config set repoBranch main
skill-ui config set repoSkillsPath skills
skill-ui config set repoDir /path/to/skills-checkout
skill-ui config set repoConfigPath /path/to/skills-checkout/skill-ui.config.json
```

### Check auth

```bash
skill-ui auth status
skill-ui auth status --json
```

Auth resolution order:

1. CLI config token from `~/.skill-ui/config.json`.
2. `SKILL_UI_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`.
3. Skill UI desktop token, including Electron safeStorage encrypted tokens.
4. `gh auth token` fallback.

If auth fails, prefer asking the user to save/test a token in Skill UI Settings or run `gh auth login`. Do not ask for a token in chat unless there is no safer path.

## Core commands

### List skills

```bash
skill-ui list
skill-ui list --json
```

Use `--json` to get structured skill rows with `name`, `description`, `version`, `repoPath`, and repo annotations when available. Bundled/default skills use synthetic paths such as `builtin/skill-ui-cli`.

### Read a full bundle

```bash
skill-ui read <skill-name-or-repo-path> --json
```

Returns skill metadata plus every file in the bundle. Use this for inspection or agent-side editing. Support files are included; binary files are base64-encoded.

### Install/download a skill

```bash
skill-ui download <skill-name-or-repo-path> --target ~/.hermes/skills
skill-ui download <skill-name-or-repo-path> --target ~/.claude/skills
skill-ui download <skill-name-or-repo-path> --target /path/to/custom/skills --json
```

Despite the name, `download` installs the full skill folder under the target directory and writes a Skill UI receipt. If `--target` is omitted, the CLI uses the first enabled configured client, then `customSkillsDir`, then `~/.hermes/skills`.

### Validate a local skill

```bash
skill-ui validate ./my-skill
skill-ui validate ./my-skill --json
```

Validation checks root `SKILL.md`, YAML frontmatter, folder/name match, non-empty description/body, safe relative paths, lifecycle/channel values, and mirror provenance where relevant.

### Scaffold a new governed skill

```bash
skill-ui scaffold my-skill \
  --owner @your-org/your-team \
  --lifecycle experimental \
  --skill-version 0.1.0 \
  --review-interval 180 \
  --channels developer \
  --author "Skill Team" \
  --license MIT \
  --source-type internal \
  --target ./skills \
  --json
```

Important scaffold flags:

- `--owner`: writes `metadata.organization.owner`.
- `--lifecycle`: one of `experimental`, `review`, `active`, `maintain`, `deprecated`, `archived`.
- `--skill-version`: writes `metadata.organization.version`. Use this instead of `--version`, which prints the CLI version.
- `--review-interval`: writes `metadata.organization.review_interval_days`.
- `--channels`: comma-separated list such as `developer` or `developer,runtime`.
- `--author`: optional top-level `author`.
- `--license`: optional top-level `license`; prefer an SPDX identifier.
- `--source-type`: optional `metadata.organization.source_type`; use `internal` for newly-authored internal skills.

If a field is omitted, Skill UI uses repository/config defaults where possible. Blank optional metadata is omitted rather than written as empty values.

### Import or mirror a remote GitHub skill

Inspect a remote skill as a mirror-ready bundle:

```bash
skill-ui remote https://github.com/anthropics/skills/tree/main/skills/pdf \
  --name anthropic-pdf \
  --owner @your-org/your-team \
  --json
```

Open a mirror pull request:

```bash
skill-ui mirror https://github.com/anthropics/skills/tree/main/skills/pdf \
  --name anthropic-pdf \
  --owner @your-org/your-team \
  --dry-run --json
```

Remote imports preserve upstream files, add mirror metadata, and generate `upstream.lock.yaml` and `PATCHES.md` when missing.

### Upload or update repository skills

Upload a new local skill folder:

```bash
skill-ui upload ./my-skill --dry-run --json
skill-ui upload ./my-skill --note "Initial version"
```

Upload changes for an existing skill:

```bash
skill-ui update ./my-skill --dry-run --json
skill-ui update ./my-skill --note "Improve install guidance"
```

Real upload/update validates the folder, writes files under the configured skills path on a new branch, and opens a pull request. Report the returned PR URL and branch.

### Check repository health

```bash
skill-ui doctor --json
```

Doctor checks real skills against marketplace manifests, trigger evals, skills hub catalog entries, source mismatches, and extra manifest/catalog entries. It honors configured repository conventions from `skill-ui.config.json`.

## Standard agent workflows

### Discover and install

Use this before starting a task when a task-specific skill might already exist.

1. `skill-ui list --json`
2. Read each candidate's `description` and pick only skills whose trigger matches the current task.
3. `skill-ui read <name> --json` if you need to inspect the full skill before using it.
4. `skill-ui download <name> --target <client-skills-dir> --json`
5. Tell the user which skill was selected, why, the installed directory, and whether the target client must reload skills.

### Create and publish

1. Scaffold with metadata:
   ```bash
   skill-ui scaffold my-skill --owner @your-org/your-team --lifecycle experimental --skill-version 0.1.0 --channels developer --json
   ```
2. Write/edit the generated bundle locally.
3. `skill-ui validate ./my-skill --json`
4. `skill-ui upload ./my-skill --dry-run --json`
5. `skill-ui upload ./my-skill --note "Describe the purpose"`
6. Report the PR URL and branch.

### Update from local edits

1. `skill-ui read <name> --json` or `skill-ui download <name> --target /tmp/skill-edit`
2. Edit the full local bundle; preserve support files.
3. `skill-ui validate ./skill-folder --json`
4. `skill-ui update ./skill-folder --dry-run --json`
5. `skill-ui update ./skill-folder --note "Summarize the changes"`

Use `update` for an installed/downloaded repository skill after the user asks to change the skill content. It opens a pull request against the configured skill repository. For a GitHub URL that is not yet part of the repository, use `remote`/`mirror` first; `update` does not patch an arbitrary upstream remote skill in place.

## Output handling

Successful commands generally return enough data to verify the action:

- `list --json`: array of available skills.
- `read --json`: skill metadata and file list/content.
- `download --json`: installed directory, skill metadata, and receipt.
- `validate --json`: validity and errors.
- `remote --json`: mirror-ready bundle and upstream provenance.
- `mirror/upload/update --json`: PR URL, PR number, and branch when a real PR is opened; dry-run payload when `--dry-run` is used.
- `doctor --json`: repository health report.
- `config get --json`: resolved settings/defaults with tokens redacted.

Do not claim success unless the command exits with status 0 and returned data matches the requested action.

## Safety rules

- Never print or store tokens in skill content or chat summaries.
- Prefer `--dry-run` before `upload`, `update`, or `mirror`.
- Validate before publishing.
- Preserve support folders; do not flatten a multi-file skill into one Markdown file.
- Do not overwrite a user's local skill unless they asked to install/update it.
- When installing, report the exact target directory.
- When publishing, report the PR URL and branch.
- If PR creation fails after a branch push, verify remote state and give the user a compare URL rather than retrying blindly.

## Troubleshooting

### `skill-ui` command not found

From a development checkout:

```bash
node bin/skill-ui.js --help
```

If installed from npm or a packaged release, ensure the package binary is on `PATH`.

### Cannot access the repository

Run:

```bash
skill-ui auth status
skill-ui config get --json
```

If auth uses the wrong GitHub account, save a token in Skill UI Settings or set `SKILL_UI_TOKEN`/`GITHUB_TOKEN` for this shell.

### Installed skill does not appear in the client

Check:

1. The target directory was correct.
2. The installed folder contains root `SKILL.md`.
3. The target client supports skills from that directory.
4. The client was restarted or reloaded if it only discovers skills on startup.

## Verification checklist

Before telling the user a Skill UI CLI operation succeeded, verify:

- [ ] `skill-ui auth status` succeeds when repository access is needed.
- [ ] `skill-ui config get --json` points to the expected repository or intentional override.
- [ ] `skill-ui list --json` includes the target skill before install/read.
- [ ] `skill-ui read <name> --json` includes expected support files when inspecting bundles.
- [ ] `skill-ui download ... --json` returns the installed directory for installs.
- [ ] `skill-ui validate ... --json` passes before upload/update.
- [ ] `skill-ui upload/update/mirror ...` returns a PR URL for publishing workflows.
- [ ] The installed skill path exists on disk when local installation was requested.
