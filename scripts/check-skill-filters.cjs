#!/usr/bin/env node
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'renderer', 'src', 'lib', 'skillFilters.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const sandboxModule = { exports: {} }
vm.runInNewContext(js, { module: sandboxModule, exports: sandboxModule.exports, require }, { filename: sourcePath })

const { buildInstallMap, filterRepoSkills, isRemoteSkill, ownerOptions } = sandboxModule.exports
const names = (items) => items.map((item) => item.name)
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected)

const repoSkills = [
  { name: 'ours', description: '', version: '1.0.0', hash: 'r1', repoPath: 'skills/ours', owner: '@team/a', sourceType: 'internal', remote: false },
  { name: 'mirror', description: '', version: '2.0.0', hash: 'r2', repoPath: 'skills/mirror', owner: '@team/b', sourceType: 'mirrored-public', remote: true },
  { name: 'fresh', description: '', version: '1.0.0', hash: 'r3', repoPath: 'skills/fresh', owner: '@team/a', sourceType: 'internal', remote: false }
]
const localSkills = [
  { name: 'ours', description: '', version: '0.9.0', hash: 'l1', clientId: 'hermes', dir: '/tmp/ours', receipt: { sourcePath: 'skills/ours' }, update: { state: 'outdated' } },
  { name: 'mirror', description: '', version: '2.0.0', hash: 'l2', clientId: 'hermes', dir: '/tmp/not-the-folder-name', receipt: { sourcePath: 'skills/mirror' }, update: { state: 'up-to-date' } }
]
const installMap = buildInstallMap(repoSkills, localSkills)

same(ownerOptions(repoSkills), ['@team/a', '@team/b'])
assert.equal(isRemoteSkill(repoSkills[0]), false)
assert.equal(isRemoteSkill(repoSkills[1]), true)
assert.equal(installMap['skills/ours'].installed, true)
assert.equal(installMap['skills/ours'].updatable, true)
assert.equal(installMap['skills/mirror'].installed, true)
assert.equal(installMap['skills/mirror'].updatable, false)
assert.equal(installMap['skills/fresh'].installed, false)
same(names(filterRepoSkills(repoSkills, installMap, { owner: '@team/a', source: 'all', install: 'all', updatableOnly: false })), ['ours', 'fresh'])
same(names(filterRepoSkills(repoSkills, installMap, { owner: '', source: 'remote', install: 'all', updatableOnly: false })), ['mirror'])
same(names(filterRepoSkills(repoSkills, installMap, { owner: '', source: 'own', install: 'not-installed', updatableOnly: false })), ['fresh'])
same(names(filterRepoSkills(repoSkills, installMap, { owner: '', source: 'all', install: 'all', updatableOnly: true })), ['ours'])

console.log('skill filter checks passed')
