#!/usr/bin/env node
const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const workDir = path.join(repoRoot, '.loop', 'tmp', 'repo-config-smoke')
const configPath = path.join(workDir, 'skill-ui.config.json')

fs.mkdirSync(workDir, { recursive: true })
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      repository: { owner: 'acme', name: 'skills', branch: 'trunk', skillsPath: 'library' },
      defaults: {
        owner: '@acme/agents',
        lifecycle: 'maintain',
        mirrorLifecycle: 'review',
        version: '0.2.0',
        reviewIntervalDays: 90,
        channels: ['developer', 'runtime']
      },
      clients: [{ id: 'hermes', label: 'Hermes Test', path: '~/tmp/hermes-skills', enabled: true }],
      conventions: {
        claudeMarketplacePath: 'marketplaces/claude.json',
        copilotMarketplacePath: 'marketplaces/copilot.json',
        skillsHubCatalogPath: 'catalog/skills.sh.json',
        evalsPath: 'checks/triggers',
        bundleExcludeNames: ['catalog']
      }
    },
    null,
    2
  ) + '\n'
)

function skillUi(args) {
  return execFileSync(process.execPath, [path.join(repoRoot, 'bin', 'skill-ui.js'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
}

const resolved = JSON.parse(skillUi(['config', 'get', '--config', configPath, '--json']))
assert.strictEqual(resolved.repoOwner, 'acme')
assert.strictEqual(resolved.repoName, 'skills')
assert.strictEqual(resolved.repoBranch, 'trunk')
assert.strictEqual(resolved.repoSkillsPath, 'library')
assert.strictEqual(resolved.configuredClients[0].label, 'Hermes Test')
assert.strictEqual(resolved.repoConventions.evalsPath, 'checks/triggers')

const scaffold = JSON.parse(skillUi(['scaffold', 'demo-skill', '--config', configPath, '--json']))
const skillMd = scaffold.files.find((file) => file.path === 'SKILL.md')?.content || ''
assert.match(skillMd, /owner: "@acme\/agents"/)
assert.match(skillMd, /lifecycle: maintain/)
assert.match(skillMd, /version: "0\.2\.0"/)
assert.match(skillMd, /review_interval_days: 90/)
assert.match(skillMd, /      - runtime/)

console.log('repo-config smoke: PASS')
