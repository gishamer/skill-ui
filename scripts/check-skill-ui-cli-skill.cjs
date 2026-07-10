#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const skillPath = path.join(repoRoot, 'bundled-skills', 'skill-ui-cli', 'SKILL.md')
const content = fs.readFileSync(skillPath, 'utf8')

for (const expected of [
  'full shared agent skill bundles',
  'skill-ui.config.json',
  '--skill-version',
  '--review-interval',
  '--channels',
  '--author',
  '--license',
  '--source-type',
  'skill-ui doctor --json',
  'metadata.organization.owner',
  'Remote imports preserve upstream files',
  'Preserve support folders'
]) {
  assert(content.includes(expected), `skill-ui-cli skill missing: ${expected}`)
}

assert(!content.includes('--version VERSION'))
assert(!content.includes('assume a skill is only one markdown file'))

console.log('skill-ui-cli bundled skill smoke: PASS')
