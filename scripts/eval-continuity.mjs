import process from 'node:process'
import { createOpenAIContinuityBriefGenerator } from '../server/openai-continuity-brief.mjs'

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required for the continuity evaluation.')
  process.exit(1)
}

const model = process.env.OPENAI_CONTINUITY_MODEL || process.env.OPENAI_CANON_MODEL || 'gpt-5.6-luna'
const generator = createOpenAIContinuityBriefGenerator({ apiKey: process.env.OPENAI_API_KEY, model })
const now = new Date().toISOString()
const messages = [
  { id: 'promise-1', roomId: 'fireside', roomName: 'fireside', senderName: 'Mara', text: 'We promise to return Ilyra’s compass before moonrise.', sentAt: now },
  { id: 'departure-1', roomId: 'fireside', roomName: 'fireside', senderName: 'Theo', text: 'We leave for the salt caves without returning the compass.', sentAt: now },
  { id: 'banter-1', roomId: 'fireside', roomName: 'fireside', senderName: 'Mara', text: 'OOC joke: the moon is definitely made of cheese.', sentAt: now },
  { id: 'sigil-1', roomId: 'planning', roomName: 'planning', senderName: 'Theo', text: 'Who carved the brass moth sigil into the archive door?', sentAt: now },
]
const acceptedCanon = [{
  id: 'canon-1', kind: 'promise', title: 'Return Ilyra’s compass', claim: 'The party promised to return Ilyra’s compass before moonrise.', visibility: 'gm_only',
  sources: [{ messageId: 'promise-1', roomId: 'fireside', roomName: 'fireside', senderName: 'Mara', text: messages[0].text, excerpt: null, sentAt: now, sequence: 1 }],
}]

try {
  const threads = await generator.generate({ campaignId: 'continuity-eval', messages, acceptedCanon })
  const knownIds = new Set(messages.map((message) => message.id))
  const searchable = threads.map((thread) => `${thread.title} ${thread.summary} ${thread.whyItMatters}`).join(' ').toLocaleLowerCase()
  const passed = threads.length > 0
    && threads.length <= 3
    && threads.every((thread) => thread.sources.length > 0 && thread.sources.every((source) => knownIds.has(source.messageId)))
    && !searchable.includes('moon is made of cheese')
    && (searchable.includes('compass') || searchable.includes('sigil'))
  if (!passed) {
    console.error(`FAIL continuity brief (${threads.length} threads)`)
    process.exitCode = 1
  } else {
    console.log(`PASS continuity brief (${threads.length} cited threads)`)
    console.log(`Continuity evaluation passed on ${model}.`)
  }
} catch (error) {
  console.error(`FAIL continuity brief: ${error.code ?? error.name ?? 'error'}`)
  process.exitCode = 1
}
