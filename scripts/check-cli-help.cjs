#!/usr/bin/env node
const assert = require('assert')
const { execFileSync } = require('child_process')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const help = execFileSync(process.execPath, [path.join(repoRoot, 'bin', 'skill-ui.js'), 'help'], {
  cwd: repoRoot,
  encoding: 'utf8'
})

for (const expected of [
  'full multi-file skill bundles',
  'skill-ui.config.json/.skill-ui.json',
  '--skill-version VERSION',
  '--review-interval DAYS',
  '--channels LIST',
  '--author NAME',
  '--license SPDX',
  '--source-type TYPE',
  'Install a full skill bundle and write a receipt',
  'Validate SKILL.md plus all support files before upload',
  'Target skills directory; omitted uses configured client/custom/Hermes fallback',
  'config get                   Show resolved repo/client/default/convention config'
]) {
  assert(help.includes(expected), `help missing: ${expected}`)
}

assert(!help.includes('scaffold <name> [--owner TEAM] [--lifecycle STATE] [--version VERSION]'))
assert(!help.includes('--version VERSION            Initial version for scaffolded skills'))

console.log('cli-help smoke: PASS')
