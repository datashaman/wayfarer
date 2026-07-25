import process from 'node:process'
import { join, resolve } from 'node:path'
import { createStore } from '../server/store.mjs'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

const suite = argument('--suite')
const model = argument('--model')
const generatorVersion = argument('--version')
const passed = Number(argument('--passed'))
const total = Number(argument('--total'))
if (!suite || !model || !generatorVersion || !Number.isInteger(passed) || !Number.isInteger(total) || total < 1 || passed < 0 || passed > total) {
  console.error('Usage: npm run eval:record -- --suite NAME --model NAME --version VERSION --passed N --total N [--campaign ID] [--notes TEXT]')
  process.exit(1)
}
const databasePath = resolve(argument('--database') || process.env.DATABASE_PATH || join(process.cwd(), 'data', 'wayfarer.sqlite'))
const store = createStore(databasePath)
try {
  const run = store.recordAiEvaluationRun({ campaignId: argument('--campaign'), suite, model, generatorVersion, passed, total, notes: argument('--notes') })
  process.stdout.write(`${JSON.stringify(run, null, 2)}\n`)
} finally {
  store.close()
}
