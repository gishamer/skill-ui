# Skill UI

Skill UI is a desktop app and agent-facing CLI for managing shared `SKILL.md`
agent skills across an organisation. It is designed to be the one-stop-shop for
finding, installing, creating, updating, and publishing skills without every
agent or user having to know GitHub repository URLs, branch names, paths, or
token details.

It supports both humans and agents:

- **Humans** use the Electron app to browse, install, create, edit, validate,
  and publish skills with a friendly UI.
- **Agents** use the `skill-ui` CLI to perform the same workflows from Hermes,
  Claude Code, Claude Desktop, or other clients.

Skill UI manages skills for clients that load folders containing a root
`SKILL.md` file:

| Client | Default skills directory |
| --- | --- |
| Claude Desktop / Claude Code | `~/.claude/skills` |
| Hermes | `~/.hermes/skills` |
| Custom client | any directory you choose |

## What it does

- **Browse skills** — see bundled/default skills plus every skill published to
  the configured GitHub skill repository.
- **Install skills** — install a skill into one or more local client directories
  with one click in the app or one CLI command.
- **Bundled default skills** — ship always-available skills with Skill UI itself.
  The default `skill-ui-cli` skill teaches agents how to use the CLI and is
  available even before a repository is connected.
- **Create a skill** — scaffold a new skill via `npx skills init`, with a built-in
  template fallback when npm is unavailable.
- **Import full skill folders** — preserve multi-file skills with supporting
  folders such as `references/`, `scripts/`, `templates/`, and `assets/`.
- **Import remote public skills** — fetch a GitHub-hosted skill, convert it into
  a mirror-ready bundle with organization lifecycle metadata,
  `upstream.lock.yaml`, and `PATCHES.md`, then review/upload it as a PR.
- **Validate skills** — check `SKILL.md` frontmatter, skill/folder name matching,
  safe paths, required content, lifecycle states, channels, and mirrored-public
  provenance fields before installing or publishing.
- **Edit skills** — edit installed or repository skills, then reinstall locally or
  open a pull request. Bundled/default skills are installable but not editable in
  the repository editor.
- **Update installed skills** — compare local installations against the repository
  and update outdated copies.
- **Upload as pull requests** — publish new or changed skills by opening a GitHub
  pull request instead of writing directly to the default branch.
- **Agent CLI workflows** — let agents list, read, download/install, validate,
  upload, and update skills through a single `skill-ui` command.

## Skill sources

Skill UI can show skills from multiple sources in one catalog.

### Bundled/default skills

Bundled skills live in this repository under:

```text
bundled-skills/<skill-name>/SKILL.md
```

They are shipped with Skill UI and are available even if no GitHub skill
repository is configured or reachable. In the app and CLI they use a synthetic
repository path:

```text
builtin/<skill-name>
```

The first bundled skill is:

```text
builtin/skill-ui-cli
```

Install it into an agent client to teach that client how to use the Skill UI CLI:

```bash
skill-ui download skill-ui-cli --target ~/.hermes/skills
skill-ui download skill-ui-cli --target ~/.claude/skills
```

### Shared repository skills

A shared skill repository is a GitHub repository where every skill lives in its
own folder and each folder contains a root `SKILL.md` file.

Example layout when skills live at the repository root:

```text
skill-repo/
├── pdf-extractor/
│   └── SKILL.md
├── incident-summary/
│   └── SKILL.md
└── jira-helper/
    └── SKILL.md
```

Example layout when skills live below a `skills/` folder:

```text
skill-repo/
└── skills/
    ├── pdf-extractor/
    │   └── SKILL.md
    └── jira-helper/
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
| Skills path | leave blank if skills are at the repo root, or use `skills` if the repo contains a `skills/` folder |

You can also commit a `skill-ui.config.json` file to the skill repository and point
Skill UI at it in Settings or with `skill-ui --config ./skill-ui.config.json`.
This lets the repository carry its own portable defaults instead of relying on
machine-local UI settings.

```json
{
  "repository": {
    "owner": "your-org",
    "name": "skills",
    "branch": "main",
    "skillsPath": "skills"
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
    { "id": "claude", "label": "Claude", "path": "~/.claude/skills", "enabled": true }
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

The configuration candidates are:

- repository coordinates and optional local checkout;
- default metadata for newly created skills, including owner/team, lifecycle,
  mirror lifecycle, version, review interval, and channels;
- installed clients and their skills directories, including which clients are
  enabled for this repository;
- repository conventions that vary across skill repos, such as marketplace
  manifest paths, trigger-eval root path, skills hub catalog path, and additional
  bundle exclusions.

> The `git@github.com:...` URL is useful when cloning with Git over SSH, but
> Skill UI talks to GitHub through the API. That means it needs a GitHub token;
> it does not rely on the current terminal's SSH key or `gh` account.

> New repositories must have a first commit before Skill UI can upload a skill.
> If you created an empty repository on GitHub, initialize it first by adding a
> README, creating the first commit on GitHub, or pushing an initial commit from
> your local machine. The branch you enter in Skill UI, usually `main`, must exist.

### Remote public skill mirrors

Use **Create → Import remote skill mirror** to bring a GitHub-hosted skill into
an internal review flow. Provide a GitHub `tree` or `blob` URL, for example:

```text
https://github.com/anthropics/skills/tree/main/skills/pdf
```

Skill UI fetches the remote folder, rewrites the mirrored skill name when you
provide a destination name such as `anthropic-pdf`, and adds the governance files
expected by the organization lifecycle/distribution model:

- `metadata.organization.owner`, `lifecycle`, `source_type: mirrored-public`, and
  `mirror` provenance in `SKILL.md`;
- `upstream.lock.yaml` with source, path, ref, commit, tree hash, mirror date,
  and local revision;
- `PATCHES.md` for documenting internal changes on top of upstream.

The imported bundle opens in the normal editor so you can inspect license terms,
review scripts/references, install locally for testing, or upload it as a PR to
the configured internal skills repository. Publication remains Git/PR based;
Agent Registry or runtime publication should consume the reviewed repository
copy downstream.

## GitHub token setup

Skill UI uses a GitHub token to:

- read repository files and list available skills;
- create branches and commits when you upload or edit a skill;
- open pull requests for review.

Recommended: create a **fine-grained personal access token**:

1. Open GitHub: <https://github.com/settings/personal-access-tokens/new>
2. Give it a clear name, for example `Skill UI`.
3. Set an expiration date.
4. Under **Repository access**, choose **Only select repositories** and select your
   skill repository.
5. Under **Repository permissions**, grant:
   - **Contents**: `Read and write`
   - **Pull requests**: `Read and write`
   - **Metadata**: `Read-only` (GitHub enables this automatically)
6. Click **Generate token** and copy the token immediately. GitHub will only show
   it once.

A classic token also works if needed: create one at
<https://github.com/settings/tokens/new> with the `repo` scope for private
repositories or `public_repo` for public repositories. Prefer a fine-grained
token for least-privilege access.

The desktop app stores the token encrypted on the local machine using Electron
safeStorage / OS keychain support. The CLI can reuse that encrypted desktop token
so agents get the same repository access as the app, even when the terminal's
current `gh` account cannot access the skill repository.

## Desktop app workflow

### Configure Skill UI

Open **Settings** and fill in:

1. **Skill Repository**
   - **Owner**: GitHub user or organisation, for example `your-org`
   - **Repository**: repository name, for example `your-skill-repo`
   - **Branch**: usually `main`
   - **Skills path**: folder inside the repo that contains skill folders; leave it
     blank if skill folders are directly at the repository root
2. **GitHub Access Token**
   - paste the token you generated above
   - the token is stored encrypted on this machine
3. **Custom Skills Directory** *(optional)*
   - add another local install target if you want Skill UI to install skills
     somewhere other than Claude Desktop or Hermes

Click **Save settings**, then **Test connection**. If the connection succeeds,
the Repository page can list both bundled skills and repository skills.

### Install a skill

1. Go to **Repository**.
2. Choose a bundled or repository skill.
3. Click **Install**.
4. Pick one or more client directories.
5. Restart or reload the target client if it only discovers skills on startup.

### Create and publish a skill

1. Go to **Create**.
2. Scaffold a small skill, or choose **Import folder** if you already have a full
   skill folder with support files.
3. Choose **Install locally** to test it in Claude Desktop, Hermes, or a custom
   target.
4. Choose **Upload as PR** when you want to publish it to the shared repository.
5. Review and merge the pull request on GitHub.
6. Go back to **Repository** and install the published skill from there.

### Mirror a remote skill

1. Go to **Create**.
2. Paste a GitHub skill folder/blob URL in **Import remote skill mirror**.
3. Set the internal owner, lifecycle state, and optional mirror name.
4. Click **Import remote**.
5. Review the generated `SKILL.md`, `upstream.lock.yaml`, `PATCHES.md`, and any
   scripts/licenses from upstream.
6. Choose **Upload to repository** to open the reviewed mirror PR.

### Edit or update skills

- Repository and installed skills can be opened in **Edit**, changed, validated,
  reinstalled, or uploaded as a pull request.
- Bundled skills are intended to ship with Skill UI. They can be installed, but
  the app hides the **Edit** action for them.
- The **Installed** page can check whether local skills are outdated and update
  them from the repository.

## CLI workflow

The package exposes a `skill-ui` binary. From a development checkout you can run
it directly as:

```bash
node bin/skill-ui.js --help
```

When installed as a package or distributed with the app, use:

```bash
skill-ui --help
```

### CLI commands

```text
skill-ui list                         List bundled and repository skills
skill-ui read <skill>                 Print a bundled/repository skill bundle as JSON, including support files
skill-ui download <skill> --target DIR
                                      Download/install a bundled or repository skill
skill-ui validate <skill-dir>         Validate a local skill folder
skill-ui scaffold <name>              Create a governed skill template with adjustable metadata defaults
skill-ui remote <github-url>          Print a mirror-ready remote skill bundle as JSON
skill-ui mirror <github-url>          Open a mirror PR for a remote GitHub skill
skill-ui upload <skill-dir>           Upload a new skill as a pull request
skill-ui update <skill-dir>           Upload changes as a pull request
skill-ui config get                   Show resolved config/defaults with tokens redacted
skill-ui config set <key> <value>     Set CLI overrides
skill-ui auth status                  Show which auth source is being used
skill-ui doctor                       Check repository health (skills, marketplaces, evals)
```

Most commands support `--json` for agent-safe structured output.

### Common CLI examples

List all available skills:

```bash
skill-ui list --json
```

Install the default Skill UI CLI skill into Hermes:

```bash
skill-ui download skill-ui-cli --target ~/.hermes/skills
```

Install the default Skill UI CLI skill into Claude:

```bash
skill-ui download skill-ui-cli --target ~/.claude/skills
```

Read a skill bundle for inspection:

```bash
skill-ui read skill-ui-cli --json
```

Validate a local skill folder:

```bash
skill-ui validate ./my-skill
skill-ui validate ./my-skill --json
```

Create a governed skill template from the CLI:

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
  --target ./skills
```

Dry-run an upload before creating a pull request:

```bash
skill-ui upload ./my-skill --dry-run --json
```

Configure and check an organization skills repository from a local checkout or repo config file:

```bash
skill-ui config set repoOwner your-org
skill-ui config set repoName skills
skill-ui config set repoBranch main
skill-ui config set repoSkillsPath skills
skill-ui config set repoDir /path/to/skills-checkout
skill-ui config set repoConfigPath /path/to/skills-checkout/skill-ui.config.json
skill-ui doctor --json
```

Dry-run a remote public mirror PR:

```bash
skill-ui mirror https://github.com/anthropics/skills/tree/main/skills/pdf \
  --name anthropic-pdf \
  --owner @your-org/your-team \
  --dry-run --json
```

Upload a new skill as a pull request:

```bash
skill-ui upload ./my-skill --note "Initial version"
```

Upload changes to an existing skill as a pull request:

```bash
skill-ui update ./my-skill --note "Improve install guidance"
```

### CLI authentication order

The CLI resolves authentication in this order:

1. CLI config token from `~/.skill-ui/config.json`.
2. Environment variables: `SKILL_UI_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`.
3. Skill UI desktop settings token, including encrypted Electron safeStorage
   tokens.
4. `gh auth token`.

Check the active source with:

```bash
skill-ui auth status
skill-ui config get --json
```

## Skill validation and versioning

Skill UI validates skills before install/upload. A valid skill must include:

- a root `SKILL.md` file;
- YAML frontmatter starting at the first byte;
- non-empty `name` and `description` fields;
- a frontmatter `name` matching the skill folder name;
- Markdown instructions after the frontmatter;
- safe relative paths for all files.

Updates compare the `metadata.version` or top-level `version` field in each
skill's `SKILL.md` frontmatter. It supports top-level `version`,
`metadata.version`, and nested organization-specific version fields such as `metadata.organization.version`. When
all version fields are missing, Skill UI falls back to comparing the content hash
of `SKILL.md`. Bump the version when you publish a change so installed copies are
offered the update.

```yaml
---
name: pdf-extractor
description: Extracts text and tables from PDF files. Use when ...
metadata:
  version: 1.2.0
---
```

Top-level `version` also works:

```yaml
---
name: pdf-extractor
description: Extracts text and tables from PDF files. Use when ...
version: 1.2.0
---
```

## Installing the app

Grab the installer for your platform from the
[Releases](https://github.com/gishamer/skill-ui/releases) page — a single
installer that sets up everything needed to run the app:

- **Windows** — `Skill UI-<version>-setup.exe`
- **macOS** — `Skill UI-<version>-<arch>.dmg`
- **Linux** — `Skill UI-<version>-<arch>.AppImage` or `.deb`

## Development

```bash
npm install      # install dependencies
npm run dev      # launch the app in development with hot reload
npm run start    # preview the built app
npm run build    # build Electron/Vite output
npm run typecheck
```

The CLI can be exercised from the repo with:

```bash
node bin/skill-ui.js --help
node bin/skill-ui.js list --json
```

## Building installers

```bash
npm run dist          # build for the current platform
npm run dist:win      # Windows (NSIS)
npm run dist:mac      # macOS (dmg, x64 + arm64)
npm run dist:linux    # Linux (AppImage + deb)
```

Output is written to `release/<version>/`. CI (`.github/workflows/release.yml`)
builds all three platforms and attaches the installers to a GitHub Release when
you push a `v*` tag.

## Architecture

- **Electron + React + TypeScript**, bundled with
  [electron-vite](https://electron-vite.org) and packaged with
  [electron-builder](https://www.electron.build).
- **Main process** (`src/main`) — filesystem and network access: GitHub
  integration (`@octokit/rest`), bundled/default skill loading, local skill
  scanning/installation, scaffolding, validation, update diffing, and encrypted
  settings.
- **Bundled skills** (`bundled-skills`) — default skills shipped with the app and
  exposed as `builtin/<skill-name>`.
- **CLI** (`bin/skill-ui.js`) — agent-facing skill operations using the same app
  configuration and auth model.
- **Electron token helper** (`bin/decrypt-token-electron.cjs`) — lets the CLI
  decrypt the desktop app's safeStorage token when needed.
- **Preload** (`src/preload`) — typed `contextBridge` API; the renderer has no
  direct Node access.
- **Renderer** (`src/renderer`) — the React UI.
- **Shared types** (`src/shared/types.ts`) — the IPC contract.

> Note: in-app AI generation of skills from a prompt is intentionally not
> included yet; the create flow scaffolds and lets you paste/edit content. The
> `SkillEditor` is the natural extension point for adding generation later.
