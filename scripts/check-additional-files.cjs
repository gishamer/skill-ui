#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const repoRoot = path.resolve(__dirname, '..')
const helperPath = path.join(repoRoot, 'src', 'renderer', 'src', 'lib', 'skillFiles.ts')
const source = fs.readFileSync(helperPath, 'utf8').replace(/^import type .*\n/, '')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText

const testModule = { exports: {} }
new Function('exports', 'module', compiled)(testModule.exports, testModule)
const { updateSkillFileContent } = testModule.exports

const files = [
  { path: 'SKILL.md', content: 'skill', encoding: 'utf8' },
  { path: 'references/one.md', content: 'old', encoding: 'utf8' },
  { path: 'assets/logo.png', content: 'iVBORw0=', encoding: 'base64' }
]

const updated = updateSkillFileContent(files, 'references/one.md', 'new')
assert.deepStrictEqual(updated.map((file) => file.path), files.map((file) => file.path))
assert.strictEqual(updated.find((file) => file.path === 'references/one.md').content, 'new')
assert.strictEqual(updated.find((file) => file.path === 'SKILL.md').content, 'skill')
assert.strictEqual(files.find((file) => file.path === 'references/one.md').content, 'old')

const binaryUnchanged = updateSkillFileContent(files, 'assets/logo.png', 'not text')
assert.strictEqual(binaryUnchanged.find((file) => file.path === 'assets/logo.png').content, 'iVBORw0=')

console.log('additional-files smoke: PASS')
