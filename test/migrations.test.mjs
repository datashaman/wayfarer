import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createStore } from '../server/store.mjs'

test('a pre-revision recap database gains history without losing its draft', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wayfarer-migration-'))
  const databasePath = join(directory, 'table.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  let store = createStore(databasePath)
  const owner = store.createCampaign('The Old Road', 'Mara')
  const message = store.addMessage({ roomId: owner.campaign.rooms[0].id, playerId: owner.player.id, clientMessageId: 'legacy-message', text: 'The party reached the old gate.' }).message
  const created = store.createSessionRecap({ campaignId: owner.campaign.id, playerId: owner.player.id, generatorVersion: 'legacy-v1', session: store.listCampaignSessions(owner.campaign.id)[0], publicSummary: 'The party reached the old gate.', gmNotes: 'The gate remains sealed.', sources: [{ messageId: message.id }] })
  store.close()

  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE session_recap_sources;
    DROP TABLE session_recap_revisions;
    CREATE TABLE legacy_session_recaps (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, generator_version TEXT NOT NULL,
      status TEXT NOT NULL, public_summary TEXT NOT NULL, gm_notes TEXT NOT NULL,
      session_id TEXT NOT NULL, session_title TEXT NOT NULL, session_status TEXT NOT NULL,
      session_start_sequence INTEGER NOT NULL, session_end_sequence INTEGER NOT NULL,
      created_by_player_id TEXT NOT NULL, created_at TEXT NOT NULL,
      published_by_player_id TEXT, published_at TEXT
    );
    INSERT INTO legacy_session_recaps SELECT
      id, campaign_id, generator_version, status, public_summary, gm_notes,
      session_id, session_title, session_status, session_start_sequence, session_end_sequence,
      created_by_player_id, created_at, published_by_player_id, published_at FROM session_recaps;
    DROP TABLE session_recaps;
    ALTER TABLE legacy_session_recaps RENAME TO session_recaps;
  `)
  database.close()

  store = createStore(databasePath)
  const migrated = store.getLatestSessionRecap(owner.campaign.id, { includeDrafts: true, includeGmNotes: true })
  assert.equal(migrated.id, created.recap.id)
  assert.equal(migrated.revision, 0)
  assert.equal(migrated.publicSummary, 'The party reached the old gate.')
  assert.deepEqual(store.listSessionRecapHistory(owner.campaign.id, migrated.id).map((revision) => revision.revision), [0])
  assert.equal(store.reviseSessionRecap(owner.campaign.id, owner.player.id, migrated.id, { publicSummary: 'The party reached and opened the old gate.', gmNotes: 'The road continues.', expectedRevision: 0 }).outcome, 'revised')
  store.close()
})
