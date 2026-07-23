import process from 'node:process'
import { createRoomServer } from './server/app.mjs'
import { parseAllowedOrigins, parseIceServers } from './server/config.mjs'
import { createOpenAICanonExtractor } from './server/openai-canon-extractor.mjs'

try {
  process.loadEnvFile?.('.env.local')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const port = Number(process.env.PORT ?? 8787)
const dev = process.argv.includes('--dev')
const app = createRoomServer({
  databasePath: process.env.DATABASE_PATH,
  dev,
  iceServers: parseIceServers(process.env.ICE_SERVERS),
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  trustProxy: process.env.TRUST_PROXY === '1',
  canonExtractor: process.env.OPENAI_API_KEY ? createOpenAICanonExtractor({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_CANON_MODEL || 'gpt-5.6-luna',
  }) : null,
})

await app.listen(port)
console.log(`Wayfarer room server listening on http://127.0.0.1:${port}`)

async function shutdown() {
  await app.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
