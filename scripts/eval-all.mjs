import process from 'node:process'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createStore } from '../server/store.mjs'
import { AI_SURFACES, modelForAiSurface, versionForAiSurface } from '../server/ai-surfaces.mjs'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

const suites = AI_SURFACES.map((surface) => {
  const model = modelForAiSurface(surface.id)
  return { name: surface.id, script: `eval-${surface.id.replace('_', '-')}.mjs`, model, version: versionForAiSurface(surface.id, model) }
})

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required for the live evaluation suite.')
  process.exit(1)
}

function runSuite(suite) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, suite.script)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk) })
    child.on('close', (code) => {
      const passed = (output.match(/^PASS /gm) ?? []).length
      const failed = (output.match(/^FAIL /gm) ?? []).length
      resolveRun({ ...suite, passed: code === 0 ? Math.max(1, passed) : passed, total: Math.max(1, passed + failed), ok: code === 0 })
    })
  })
}

const databasePath = resolve(argument('--database') || process.env.DATABASE_PATH || join(process.cwd(), 'data', 'wayfarer.sqlite'))
const campaignId = argument('--campaign')
const notes = argument('--notes')
const store = createStore(databasePath)
let failed = false
try {
  for (const suite of suites) {
    process.stdout.write(`\nRunning ${suite.name} evaluation…\n`)
    const result = await runSuite(suite)
    store.recordAiEvaluationRun({
      campaignId,
      suite: result.name,
      model: result.model,
      generatorVersion: result.version,
      passed: result.passed,
      total: result.total,
      notes,
    })
    failed ||= !result.ok
  }
} finally {
  store.close()
}

if (failed) process.exitCode = 1
else process.stdout.write('\nAll live evaluations passed and were recorded.\n')
