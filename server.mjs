import { createRoomServer } from './server/app.mjs'

const port = Number(process.env.PORT ?? 8787)
const app = createRoomServer({
  databasePath: process.env.DATABASE_PATH,
  dev: process.argv.includes('--dev'),
})

await app.listen(port)
console.log(`Wayfarer room server listening on http://127.0.0.1:${port}`)

async function shutdown() {
  await app.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
