import process from 'node:process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createFeedbackEvaluationExport } from '../server/feedback-evaluation.mjs'
import { createStore } from '../server/store.mjs'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

const databasePath = resolve(argument('--database') || process.env.DATABASE_PATH || join(process.cwd(), 'data', 'wayfarer.sqlite'))
const outputPath = argument('--output') ? resolve(argument('--output')) : null
const campaignId = argument('--campaign')

if (!existsSync(databasePath)) {
  console.error(`Feedback database does not exist: ${databasePath}`)
  process.exit(1)
}

const store = createStore(databasePath)
try {
  const evaluation = createFeedbackEvaluationExport(store.exportAiFeedback(campaignId))
  const json = `${JSON.stringify(evaluation, null, 2)}\n`
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, json, { flag: 'wx' })
    console.error(`Wrote ${evaluation.metrics.canon.total} canon and ${evaluation.metrics.continuity.total} continuity fixtures to ${outputPath}`)
  } else {
    process.stdout.write(json)
  }
} finally {
  store.close()
}
