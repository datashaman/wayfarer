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
const campaignIntelligence = {
  version: 'e2e:intelligence-v1',
  async answerKnowledge({ canon }) { return { answer: 'Ilyra is the lighthouse keeper.', citations: [canon[0].id] } },
  async draftIntent() { return ['I raise the lantern and call the party onward.', 'Let the lighthouse guide us.'] },
  async proposeFaction({ clock, messages }) { return { summary: 'The watchers move toward the old gate.', assumptions: 'The road remains open.', proposedProgress: Math.min(clock.segments, clock.progress + 1), citations: [messages[0].id] } },
  async compileHouseRule({ messages }) { return { title: 'Lantern searches', sourceRule: 'Core perception rule.', interpretation: 'Bright light reveals old marks.', ruling: 'Careful searches gain advantage.', citations: [messages[0].id] } },
  async draftCampaignSeed({ premise }) { return { title: 'The Drowned Bell', premise, pitch: 'A drowned town returns for seven nights.', truths: [{ text: 'The bell remembers every oath.' }, { text: 'The streets flood at dawn.' }, { text: 'No map agrees.' }], factions: [{ name: 'Salvagers', goal: 'Raise the bell.', opposition: 'Their oaths will surface.' }, { name: 'Tidebound', goal: 'Sink the town.', opposition: 'The town frees their enemies.' }], locations: [{ name: 'Bell Square', description: 'A flooded plaza.', danger: 'The bell punishes lies.' }, { name: 'Tilted Inn', description: 'A leaning refuge.', danger: 'The foundations move.' }, { name: 'Salt Archive', description: 'A library of salt.', danger: 'Names wake their owners.' }], npcs: Array.from({ length: 5 }, (_, index) => ({ name: `Witness ${index + 1}`, role: 'Keeper', want: 'A true name.', leverage: 'A safe route.' })), hooks: Array.from({ length: 4 }, (_, index) => ({ title: `Trouble ${index + 1}`, situation: 'A dangerous bargain.' })), openingCrisis: { title: 'The first toll', situation: 'The bell rings untouched.', stakes: 'The town sinks at the seventh toll.' }, generatorVersion: campaignIntelligence.version } },
  async draftCharacterConcepts({ world }) { return Array.from({ length: 3 }, (_, index) => ({ name: ['Iria Voss', 'Tovin Salt', 'Sera Vale'][index], concept: 'A ferryman who hears the drowned.', appearance: 'A salt-white coat.', drive: 'Find a lost sibling.', capability: 'Knows hidden crossings.', complication: 'The bell knows their oath.', possession: 'A wet iron key.', belief: 'No debt survives truth.', secret: 'They rang the bell before.', factionId: world.factions[0].id, factionConnection: 'They paid for silence.', locationId: world.locations[0].id, locationConnection: 'They drowned there.', npcId: world.npcs[0].id, npcConnection: 'The Witness knows what they did.', generatorVersion: campaignIntelligence.version })) },
  async draftInPlayMaterial({ kind }) { return { kind, title: 'Brother Vey', detail: 'Keeper of the submerged archive.', pressure: 'He needs the name the sea took before the tide turns.', leverage: 'He knows a dry road beneath the town.', generatorVersion: campaignIntelligence.version } },
}
const app = createRoomServer({ databasePath: ':memory:', dev: true, continuityGenerator, recapGenerator, campaignIntelligence })
await app.listen(Number(process.env.PORT ?? 8792))

async function shutdown() {
  await app.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
