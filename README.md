# Skill UI

Skill UI is a desktop app and agent-facing CLI for discovering, installing,
creating, editing, validating, mirroring, updating, and publishing Agent Skills.
It is built for shared skill repositories where each skill is a folder with a
root `SKILL.md` plus optional support files such as `references/`, `scripts/`,
`templates/`, `assets/`, and changelogs.

The goal is simple: humans get a friendly Electron UI, and agents get a stable
`skill-ui` command, without every client needing to know GitHub URLs, branch
names, skill paths, install directories, token sources, or repository conventions.

## Install and launch

Recommended install:

```bash
npm install -g skill-ui
skill-ui --help
skill-ui open
```

This single npm package installs the global `skill-ui` CLI and the packaged desktop UI. Use `skill-ui ...` for agent/skill workflows and `skill-ui open` to launch the UI.

If you are testing from a checkout before publishing to npm:

```bash
npm install
npm run build
node bin/skill-ui.js --help
node bin/skill-ui.js open
```

Native installers remain optional convenience downloads for users who prefer a platform app launcher.

## Who it is for

- **Humans** use the Electron app to browse, install, create, import, edit,
  validate, and publish skills.
- **Agents** use the CLI to list available skills, read descriptions, inspect
  full bundles, install task-relevant skills, and open PRs for skill changes.
- **Teams** use a shared GitHub repository plus optional `skill-ui.config.json`
  defaults to govern skill metadata, marketplace exposure, eval locations, and
  install targets.

Skill UI currently targets local folder-based skill clients:

| Client | Default or typical skills directory |
| --- | --- |
| Claude Desktop / Claude Code | `~/.claude/skills` |
| Hermes | `~/.hermes/skills` |
| Copilot / VS Code-style clients | `~/.copilot/skills` |
| Custom / configured clients | any directory in settings or repo config |

## Current capabilities

- **Discover skills** — list bundled/default skills plus configured repository
  skills; descriptions are shown so agents can choose task-relevant skills before
  installing them.
- **Read full skill bundles** — inspect `SKILL.md` and every support file in a
  skill folder, including text and binary files.
- **Install skills** — copy a full bundle into one or more local client skill
  directories and write a Skill UI receipt for future status checks.
- **Bundled default skill** — `skill-ui-cli` ships with the app and teaches agents
  how to use the CLI, even before a shared repository is configured.
- **Create skills** — scaffold a skill with governed metadata defaults; the app
  tries the wider `npx skills init` workflow and falls back to a built-in template
  when offline or unavailable.
- **Edit skills** — edit structured frontmatter, the `SKILL.md` body, and text
  support files while preserving binary support files.
- **Validate skills** — check folder/name rules, root `SKILL.md`, YAML
  frontmatter, descriptions, lifecycle/channel fields, safe paths, support files,
  and mirror provenance before install or upload.
- **Import local folders** — bring an existing multi-file skill folder into the
  editor without flattening it to a single Markdown file.
- **Mirror remote GitHub skills** — fetch a GitHub-hosted skill folder or
  `SKILL.md`, add mirror provenance, generate `upstream.lock.yaml` and
  `PATCHES.md`, review it, then upload it as a PR to the configured repository.
- **Publish through PRs** — upload new skills or updates to existing skills by
  creating a branch, committing the bundle under the configured skills path, and
  opening a GitHub pull request.
- **Update installed skills** — compare installed bundles against repository
  bundles using receipts and hashes, update clean outdated installs, and avoid
  overwriting local modifications without review.
- **Adopt local edits** — when local checkout mode is configured, diff a modified
  installed skill and copy the edited bundle back into the repository checkout for
  review and upload.
- **Check repository health** — verify skills against Claude/Copilot marketplace
  manifests, Skills Hub catalog groupings, trigger eval locations, and source
  mismatches.
- **Use local checkout mode** — browse, read, install, doctor, and adopt changes
  from a local checkout for fast/offline work while still using GitHub for PRs.

## Skill sources

Skill UI merges multiple sources into one catalog.

### Bundled/default skills

Bundled skills live in this repository under:

```text
bundled-skills/<skill-name>/SKILL.md
```

They are included with the app and use a synthetic repository path:

```text
builtin/<skill-name>
```

The bundled skill currently shipped by this repo is:

```text
builtin/skill-ui-cli
```

Install it into an agent client to teach that client how to discover and manage
skills through Skill UI:

```bash
skill-ui download skill-ui-cli --target ~/.hermes/skills
skill-ui download skill-ui-cli --target ~/.claude/skills
```

### Shared repository skills

A shared skill repository is a GitHub repository where each skill is a folder
containing a root `SKILL.md`.

Skills can live at the repository root:

```text
skill-repo/
├── pdf-extractor/
│   ├── SKILL.md
│   └── references/
└── incident-summary/
    └── SKILL.md
```

Or below a configured skills path:

```text
skill-repo/
└── skills/
    ├── pdf-extractor/
    │   └── SKILL.md
    └── incident-summary/
        └── SKILL.md
```

For a repository URL such as:

```text
git@github.com:your-org/your-skill-repo.git
```

configure Skill UI like this:

| Setting | Value |
| --- | --- |
| Owner | `your-org` |
| Repository | `your-skill-repo` |
| Branch | `main` |
| Skills path | leave blank for repo-root skills, or use `skills` for `skills/<name>/SKILL.md` |

> The SSH URL is useful for cloning, but Skill UI talks to GitHub through the API.
> Push/upload actions need a GitHub token with repository contents and pull-request
> permissions; they do not use your terminal SSH key.

> New repositories must have a first commit and the configured branch must exist
> before Skill UI can list or upload skills.

## Repository configuration

A skill repository can carry portable defaults in `skill-ui.config.json` or
`.skill-ui.json`. Skill UI can read that file from a configured local checkout,
from an explicit config path, or from the `SKILL_UI_REPO_CONFIG` environment
variable.

Example:

```json
{
  "repository": {
    "owner": "your-org",
    "name": "skills",
    "branch": "main",
    "skillsPath": "skills",
    "localCheckout": "/path/to/skills-checkout"
  },
  "defaults": {
    "owner": "@your-org/your-team",
    "lifecycle": "experimental",
    "mirrorLifecycle": "review",
    "version": "0.1.0",
    "reviewIntervalDays": 180,
    "channels": ["developer"]
  },
  "clients": [
    { "id": "hermes", "label": "Hermes", "path": "~/.hermes/skills", "enabled": true },
    { "id": "claude", "label": "Claude", "path": "~/.claude/skills", "enabled": true },
    { "id": "copilot", "label": "Copilot / VS Code", "path": "~/.copilot/skills", "enabled": true }
  ],
  "conventions": {
    "claudeMarketplacePath": ".claude-plugin/marketplace.json",
    "copilotMarketplacePath": ".github/plugin/marketplace.json",
    "skillsHubCatalogPath": "skills.sh.json",
    "evalsPath": "evals",
    "bundleExcludeNames": []
  }
}
```

Configurable repository conventions let different skill repos use different
marketplace manifest paths, Skills Hub catalog paths, trigger-eval roots, and
bundle exclusion names without changing the app.

## Authentication and token handling

Skill UI uses a GitHub token to:

- read repository files and list available skills;
- create blobs, trees, commits, and branches;
- open pull requests for new or updated skills.

Recommended token shape:

1. Create a fine-grained personal access token at
   <https://github.com/settings/personal-access-tokens/new>.
2. Limit it to the skill repository.
3. Grant **Contents: Read and write**, **Pull requests: Read and write**, and
   GitHub's default **Metadata: Read-only** permission.

The desktop app stores the token locally using Electron `safeStorage` when
available. The CLI resolves auth in this order:

1. CLI config token from `~/.skill-ui/config.json`.
2. `SKILL_UI_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`.
3. Skill UI desktop settings token, including encrypted Electron safeStorage
   tokens.
4. `gh auth token`.

Check what will be used:

```bash
skill-ui auth status
skill-ui config get --json
```

Token values are redacted from normal config output.

## Desktop app workflows

### Configure the repository

Open **Settings** and fill in:

1. repository owner, name, branch, and skills path;
2. optional local checkout path for fast/offline reads;
3. optional repository config JSON path;
4. optional GitHub token;
5. optional custom skills directory.

Click **Save settings**, then **Test connection**. Local checkout mode reports a
`local:<path>` connection; API mode reports the authenticated GitHub login.

### Browse and install

1. Go to **Repository**.
2. Review bundled and repository skills, including version, description,
   marketplace status, Skills Hub group, trigger eval status, and Hermes install
   identifier where available.
3. Click a card to inspect/edit a copy, or click **Install**.
4. Pick one or more client target directories.
5. Reload or restart the target client if it only scans skills on startup.

### Create or import a skill

1. Go to **Create**.
2. Scaffold a new skill with owner/lifecycle/version/channel defaults, or import
   an existing folder that contains `SKILL.md`.
3. Edit frontmatter and Markdown body. Support files are preserved; text support
   files can be edited inline and binary files are retained.
4. Install locally for testing or upload to open a repository PR.

### Mirror a remote GitHub skill

1. Go to **Create → Import remote skill mirror**.
2. Paste a GitHub repo, tree, or blob URL.
3. Optionally set the destination skill name, owner, and lifecycle.
4. Review the generated `SKILL.md`, `upstream.lock.yaml`, `PATCHES.md`, and any
   upstream support files.
5. Upload the reviewed mirror to the configured skill repository as a PR.

Remote mirror import is not an upstream patch flow. It creates or updates a
reviewable copy in your configured skill repository.

### Edit, update, and adopt installed skills

- **Edit** opens repository skills or installed skills in the editor.
- **Install locally** writes the edited bundle to selected client directories.
- **Upload to repository** opens a PR with the edited bundle.
- **Installed** checks each local skill against the current repository bundle.
- Clean outdated installs can be updated directly.
- Locally modified or diverged installs show diff/adopt actions instead of being
  overwritten automatically.
- **Adopt** copies local edits back into the configured local repository checkout;
  review and upload those changes afterward.

Bundled skills can be installed and inspected, but the repository browser hides
the direct edit action for them because bundled skills ship with the app.

## CLI workflow

From a development checkout:

```bash
node bin/skill-ui.js --help
```

When installed as a package:

```bash
npm install -g skill-ui
skill-ui --help
skill-ui open
```

### Commands

```text
skill-ui list                         List bundled and repository skills
skill-ui read <skill>                 Print a bundled/repository skill bundle as JSON, including support files
skill-ui download <skill> --target DIR
                                      Install a full skill bundle and write a receipt
skill-ui validate <skill-dir>         Validate SKILL.md plus all support files before upload
skill-ui scaffold <name>              Create a governed skill template with metadata defaults
skill-ui remote <github-url>          Print a mirror-ready remote skill bundle as JSON
skill-ui mirror <github-url>          Open a mirror PR for a remote GitHub skill
skill-ui upload <skill-dir>           Upload a new skill as a pull request
skill-ui update <skill-dir>           Upload changes for an existing skill as a pull request
skill-ui doctor                       Check skills, marketplace manifests, evals, and catalog entries
skill-ui config get                   Show resolved repo/client/default/convention config, with token redacted
skill-ui config set <key> <value>     Set CLI overrides
skill-ui auth status                  Explain which authentication source will be used
skill-ui open                         Launch the packaged desktop UI
```

Common options:

```text
--json                  Emit machine-readable JSON where supported
--repo owner/name       Override repository for one run
--branch name           Override branch for one run
--skills-path path      Override the repository path containing skill folders
--repo-dir DIR          Use a local checkout as the repository source
--config FILE           Use a skill-ui.config.json/.skill-ui.json file
--target DIR            Install target directory
--note TEXT             Pull request note/body addition
--owner TEAM            Owner metadata for created/mirrored skills
--lifecycle STATE       Lifecycle for created/mirrored skills
--skill-version VERSION Initial version for scaffolded skills
--review-interval DAYS  Review interval for scaffolded skills
--channels LIST         Comma-separated channels for scaffolded skills
--author NAME           Top-level author for scaffolded skills
--license SPDX          Top-level license for scaffolded skills
--source-type TYPE      metadata.organization.source_type for scaffolded skills
--name NAME             Destination name for mirrored remote skills
--dry-run               Validate and show intended action without writing to GitHub
```

Most commands support `--json`; use it for agent-safe structured output.

### Common examples

Launch the packaged desktop UI:

```bash
skill-ui open
```

List available skills and descriptions:

```bash
skill-ui list --json
```

Read a full bundle before deciding whether to install it:

```bash
skill-ui read skill-ui-cli --json
```

Install a skill into a client:

```bash
skill-ui download skill-ui-cli --target ~/.hermes/skills --json
skill-ui download skill-ui-cli --target ~/.claude/skills --json
```

Scaffold a governed skill folder:

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

Validate a local skill folder:

```bash
skill-ui validate ./my-skill --json
```

Configure a repository from the CLI:

```bash
skill-ui config set repoOwner your-org
skill-ui config set repoName skills
skill-ui config set repoBranch main
skill-ui config set repoSkillsPath skills
skill-ui config set repoDir /path/to/skills-checkout
skill-ui config set repoConfigPath /path/to/skills-checkout/skill-ui.config.json
skill-ui doctor --json
```

Use one-run overrides instead of saving settings:

```bash
skill-ui list --repo your-org/skills --branch main --skills-path skills --json
skill-ui doctor --repo your-org/skills --repo-dir /path/to/skills-checkout --json
```

Dry-run a remote mirror PR:

```bash
skill-ui mirror https://github.com/anthropics/skills/tree/main/skills/pdf \
  --name anthropic-pdf \
  --owner @your-org/your-team \
  --dry-run --json
```

Upload a new skill as a PR:

```bash
skill-ui upload ./my-skill --note "Initial version"
```

Upload changes to an existing repository skill as a PR:

```bash
skill-ui update ./my-skill --note "Improve install guidance"
```

## Agent usage pattern

Agents should use Skill UI as a discovery surface, not only as a downloader:

1. Run `skill-ui list --json`.
2. Compare each candidate's `description` to the current task.
3. Run `skill-ui read <name> --json` for likely matches.
4. Install only relevant skills with `skill-ui download <name> --target <dir>`.
5. Continue the task using the installed or rendered skill content.
6. If the user asks to change a downloaded repository skill, edit the local skill
   folder and run `skill-ui update <skill-dir> --dry-run --json`, then run the
   real update to open a PR after review.

For arbitrary remote GitHub skills that are not yet in the configured repository,
use `skill-ui remote` or `skill-ui mirror` first. `skill-ui update` publishes a
local repository-skill bundle to the configured repository; it does not patch an
upstream third-party repository in place.

## Validation, receipts, and update states

Skill UI validates a bundle before install/upload. A valid bundle needs:

- a safe skill folder name;
- a root UTF-8 `SKILL.md`;
- YAML frontmatter starting at the first byte;
- non-empty `name` and `description`;
- frontmatter `name` matching the folder name;
- Markdown instructions after the frontmatter;
- safe relative file paths and no `.git` or `node_modules` inside the bundle;
- required mirror files/provenance for `metadata.organization.source_type:
  mirrored-public`.

Installs write receipts under Skill UI state so later scans can distinguish:

- current installs;
- clean outdated installs;
- locally modified installs;
- diverged installs where both repo and local copy changed;
- unmanaged installs without a receipt;
- legacy symlink installs;
- blocked/unsupported targets.

Bundle hashes cover distributable files after filtering generated/repository-only
folders such as `.git`, `.loop`, `node_modules`, `out`, `dist`, `evals`, `docs`,
`schemas`, `.github`, `.claude-plugin`, `skills.lock.yaml`, and `skills.sh.json`.
Repository config can add more excluded names.

## Installing the app

Recommended developer/agent install:

```bash
npm install -g skill-ui
skill-ui open
```

Optional native installers are available from the
[Releases](https://github.com/gishamer/skill-ui/releases) page if you prefer a platform app launcher:

- **Windows** — `Skill UI-<version>-setup.exe`
- **macOS** — `Skill UI-<version>-<arch>.dmg`
- **Linux** — `Skill UI-<version>-<arch>.AppImage` or `.deb`

## Development

```bash
npm install
npm run dev
npm run start
npm run build
npm run typecheck
npm run test:repo-config
npm run test:additional-files
npm run test:create-metadata
npm run test:cli-help
npm run test:skill-ui-cli-skill
```

Exercise the CLI from a checkout:

```bash
node bin/skill-ui.js --help
node bin/skill-ui.js list --json
```

## Building installers

```bash
npm run dist          # current platform
npm run dist:win      # Windows NSIS installer
npm run dist:mac      # macOS dmg
npm run dist:linux    # Linux AppImage and deb
```

Output is written to `release/<version>/`. CI builds installers for Windows,
macOS, and Linux and attaches them to a GitHub Release when a `v*` tag is pushed.

## Architecture

- **Electron + React + TypeScript** — bundled with `electron-vite` and packaged
  with `electron-builder`.
- **Main process (`src/main`)** — GitHub API access, settings, token handling,
  repository config, bundled skills, skill bundle IO, validation, remote mirror
  import, install receipts, update-state classification, and PR creation.
- **Renderer (`src/renderer`)** — Repository, Installed, Create, Edit, and
  Settings pages plus the structured frontmatter editor.
- **Preload (`src/preload`)** — typed `contextBridge` API; the renderer has no
  direct Node access.
- **Shared types (`src/shared/types.ts`)** — IPC contracts and skill data models.
- **CLI (`bin/skill-ui.js`)** — standalone agent-facing implementation of list,
  read, download, validate, scaffold, remote, mirror, upload, update, doctor,
  config, auth, and desktop launch commands.
- **Electron token helper (`bin/decrypt-token-electron.cjs`)** — lets the CLI
  decrypt the desktop app's safeStorage token when needed.
- **Bundled skills (`bundled-skills`)** — skills shipped with the app, exposed as
  `builtin/<skill-name>`.

In-app AI generation of skills from a prompt is intentionally not included yet.
The create flow scaffolds a skill and lets you paste or edit content; the editor
is the extension point for future generation features.
