#!/usr/bin/env node
const assert = require('assert')
const { execFileSync } = require('child_process')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')

function skillUi(args) {
  return execFileSync(process.execPath, [path.join(repoRoot, 'bin', 'skill-ui.js'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
}

const scaffold = JSON.parse(skillUi([
  'scaffold',
  'metadata-skill',
  '--owner', '@acme/agents',
  '--lifecycle', 'review',
  '--skill-version', '0.3.0',
  '--review-interval', '45',
  '--channels', 'developer,runtime',
  '--author', 'Skill Team',
  '--license', 'Apache-2.0',
  '--source-type', 'internal',
  '--json'
]))

assert.equal(scaffold.skill.owner, '@acme/agents')
assert.equal(scaffold.skill.sourceType, 'internal')
assert.equal(scaffold.skill.remote, false)

const skillMd = scaffold.files.find((file) => file.path === 'SKILL.md')?.content || ''
assert.match(skillMd, /^author: "Skill Team"$/m)
assert.match(skillMd, /^license: "Apache-2.0"$/m)
assert.match(skillMd, /owner: "@acme\/agents"/)
assert.match(skillMd, /lifecycle: review/)
assert.match(skillMd, /version: "0\.3\.0"/)
assert.match(skillMd, /review_interval_days: 45/)
assert.match(skillMd, /source_type: "internal"/)
assert.match(skillMd, /      - developer/)
assert.match(skillMd, /      - runtime/)

const minimal = JSON.parse(skillUi(['scaffold', 'minimal-skill', '--json']))
const minimalSkillMd = minimal.files.find((file) => file.path === 'SKILL.md')?.content || ''
assert.doesNotMatch(minimalSkillMd, /^author:/m)
assert.doesNotMatch(minimalSkillMd, /source_type:/)

console.log('create-metadata smoke: PASS')
