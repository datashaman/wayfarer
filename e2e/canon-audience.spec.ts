import { expect, test } from '@playwright/test'

test('character-targeted canon hides unwitnessed evidence from other seats', async ({ browser, page }) => {
  await page.goto('/')
  await page.getByLabel('Campaign name').fill('The Veiled Coast')
  await page.getByLabel('Your name').fill('Mara')
  await page.getByRole('button', { name: 'Open the table' }).click()
  await page.getByRole('button', { name: 'I saved my seat key' }).click()
  await page.getByRole('button', { name: 'Invite players' }).click()
  const invitation = page.getByRole('dialog', { name: 'The Veiled Coast' })
  const inviteUrl = await invitation.locator('.invite-link code').innerText()

  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  await guest.goto(inviteUrl)
  await guest.getByLabel('Your name').fill('Rowan')
  await guest.getByRole('button', { name: 'Join the table' }).click()
  await guest.getByRole('button', { name: 'I saved my seat key' }).click()

  await invitation.getByRole('complementary').getByLabel('Close invitation').click()
  await page.getByLabel('Message fireside').fill('The royal signet belongs to Rowan.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem('wayfarer-saved-seats') ?? '[]')[0]?.token ?? ''
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const [members, search] = await Promise.all([
      fetch('http://127.0.0.1:8792/api/campaign/members', { headers }).then((response) => response.json()),
      fetch('http://127.0.0.1:8792/api/campaign/search?q=signet', { headers }).then((response) => response.json()),
    ])
    const proposal = await fetch('http://127.0.0.1:8792/api/campaign/canon/proposals', {
      method: 'POST', headers,
      body: JSON.stringify({ kind: 'fact', title: 'Rowan’s signet', claim: 'The royal signet belongs to Rowan.', visibility: 'gm_only', confidence: 0.9, extractorVersion: 'e2e-fixture-v1', sources: [{ messageId: search.results[0].id }] }),
    }).then((response) => response.json())
    await fetch(`http://127.0.0.1:8792/api/campaign/canon/proposals/${proposal.proposal.id}/decisions`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'accept', visibility: 'characters', audiencePlayerIds: [members.players.find((player: { name: string }) => player.name === 'Rowan').id] }),
    })
  })

  await guest.getByRole('button', { name: 'Canon' }).click()
  const guestLedger = guest.getByRole('dialog', { name: 'Living canon ledger' })
  await expect(guestLedger.getByText('The royal signet belongs to Rowan.', { exact: true })).toBeVisible()
  await expect(guestLedger.getByText(/GM-confirmed knowledge/)).toBeVisible()
  await expect(guestLedger.getByRole('button', { name: /Open citation/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Canon' }).click()
  const ownerLedger = page.getByRole('dialog', { name: 'Living canon ledger' })
  await expect(ownerLedger.locator('.canon-entry').getByText('Rowan', { exact: true })).toBeVisible()
  await expect(ownerLedger.getByRole('button', { name: 'Open citation from Mara in fireside' })).toBeVisible()
  await guestContext.close()
})
