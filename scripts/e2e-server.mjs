import process from 'node:process'
import { createRoomServer } from '../server/app.mjs'

const continuityGenerator = {
  version: 'e2e:continuity-v1',
  async generate({ messages }) {
    return [{ title: 'The old gate', summary: 'The party crossed the old gate.', whyItMatters: 'The road beyond remains unexplored.', confidence: 0.9, sources: [{ messageId: messages[0].id, excerpt: null }] }]
  },
}
const recapGenerator = {
  version: 'e2e:recap-v1',
  async generate({ messages }) {
    return { publicSummary: 'The party crossed the old gate.', gmNotes: 'The road beyond remains unexplored.', sources: [{ messageId: messages[0].id, excerpt: null }] }
  },
}
const app = createRoomServer({ databasePath: ':memory:', dev: true, continuityGenerator, recapGenerator })
await app.listen(Number(process.env.PORT ?? 8792))

async function shutdown() {
  await app.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
