import { expect, test } from '@playwright/test'

test('a player can read beyond the latest hundred transcript entries', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Campaign name').fill('The Endless Chronicle')
  await page.getByLabel('Your name').fill('Mara')
  await page.getByRole('button', { name: 'Open the table' }).click()
  await page.getByRole('button', { name: 'I saved my seat key' }).click()
  await expect(page.getByLabel('Message fireside')).toBeEnabled()

  const writer = await page.evaluate(async () => {
    const ownerToken = localStorage.getItem('wayfarer-token') ?? ''
    const restored = await fetch('http://127.0.0.1:8792/api/session', { headers: { authorization: `Bearer ${ownerToken}` } }).then((response) => response.json())
    const joined = await fetch(`http://127.0.0.1:8792/api/invitations/${restored.campaign.inviteCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerName: 'Scribe' }),
    }).then((response) => response.json())
    return { token: joined.player.token as string, roomId: restored.campaign.rooms[0].id as string }
  })

  await page.evaluate(async ({ token, roomId }) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:8792/ws?token=${encodeURIComponent(token)}`)
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error('Timed out writing transcript history.')) }, 10_000)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'room.subscribe', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(), payload: {} }))
    socket.onerror = () => { window.clearTimeout(timeout); reject(new Error('History socket failed.')) }
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(String(data))
      if (event.type === 'room.snapshot') {
        for (let index = 1; index <= 125; index += 1) socket.send(JSON.stringify({
          type: 'chat.send', id: crypto.randomUUID(), roomId, sentAt: new Date().toISOString(),
          payload: { clientMessageId: `history-${index}`, text: `Chronicle entry ${index}` },
        }))
      }
      if (event.type === 'chat.message' && event.payload.text === 'Chronicle entry 125') {
        window.clearTimeout(timeout)
        socket.close()
        resolve()
      }
    }
  }), writer)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Read earlier entries' })).toBeVisible()
  await expect(page.getByText('Chronicle entry 26', { exact: true })).toBeVisible()
  await expect(page.getByText('Chronicle entry 1', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Read earlier entries' }).click()
  await expect(page.getByText('Chronicle entry 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Read earlier entries' })).toHaveCount(0)
})
