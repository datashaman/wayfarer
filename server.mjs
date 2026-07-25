import process from 'node:process'
import { createRoomServer } from './server/app.mjs'
import { parseAllowedOrigins, parseIceServers } from './server/config.mjs'
import { createOpenAICanonExtractor } from './server/openai-canon-extractor.mjs'
import { createOpenAIContinuityBriefGenerator } from './server/openai-continuity-brief.mjs'
import { createOpenAIContradictionRadar } from './server/openai-contradiction-radar.mjs'
import { createOpenAISessionRecapGenerator } from './server/openai-session-recap.mjs'
import { createOpenAICampaignIntelligence } from './server/openai-campaign-intelligence.mjs'
import { createAiInferenceSink } from './server/ai-observability.mjs'
import { modelForAiSurface } from './server/ai-surfaces.mjs'

try {
  process.loadEnvFile?.('.env.local')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const port = Number(process.env.PORT ?? 8787)
const dev = process.argv.includes('--dev')
const aiInferenceSink = createAiInferenceSink()
const onInference = (trace) => aiInferenceSink.record(trace)
const app = createRoomServer({
  databasePath: process.env.DATABASE_PATH,
  dev,
  iceServers: parseIceServers(process.env.ICE_SERVERS),
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  trustProxy: process.env.TRUST_PROXY === '1',
  aiInferenceSink,
  canonExtractor: process.env.OPENAI_API_KEY ? createOpenAICanonExtractor({
    apiKey: process.env.OPENAI_API_KEY,
    model: modelForAiSurface('canon'),
    onInference,
  }) : null,
  continuityGenerator: process.env.OPENAI_API_KEY ? createOpenAIContinuityBriefGenerator({
    apiKey: process.env.OPENAI_API_KEY,
    model: modelForAiSurface('continuity'),
    onInference,
  }) : null,
  contradictionRadar: process.env.OPENAI_API_KEY ? createOpenAIContradictionRadar({
    apiKey: process.env.OPENAI_API_KEY,
    model: modelForAiSurface('contradictions'),
    onInference,
  }) : null,
  recapGenerator: process.env.OPENAI_API_KEY ? createOpenAISessionRecapGenerator({
    apiKey: process.env.OPENAI_API_KEY,
    model: modelForAiSurface('recap'),
    onInference,
  }) : null,
  campaignIntelligence: process.env.OPENAI_API_KEY ? createOpenAICampaignIntelligence({
    apiKey: process.env.OPENAI_API_KEY,
    model: modelForAiSurface('knowledge'),
    onInference,
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
