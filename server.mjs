import { createRoomServer } from './server/app.mjs'
import { parseAllowedOrigins, parseIceServers } from './server/config.mjs'

const port = Number(process.env.PORT ?? 8787)
const dev = process.argv.includes('--dev')
const app = createRoomServer({
  databasePath: process.env.DATABASE_PATH,
  dev,
  iceServers: parseIceServers(process.env.ICE_SERVERS),
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  trustProxy: process.env.TRUST_PROXY === '1',
})

await app.listen(port)
console.log(`Wayfarer room server listening on http://127.0.0.1:${port}`)

async function shutdown() {
  await app.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
