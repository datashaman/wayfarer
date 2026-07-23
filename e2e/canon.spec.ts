import { expect, test } from '@playwright/test'

test('the owner reviews a cited canon proposal and returns to its source', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Campaign name').fill('The Salt Road')
  await page.getByLabel('Your name').fill('Mara')
  await page.getByRole('button', { name: 'Open the table' }).click()
  await page.getByRole('button', { name: 'I saved my seat key' }).click()
  await expect(page.getByLabel('Message fireside')).toBeEnabled()
  await page.getByLabel('Message fireside').fill('The lighthouse keeper is called Ilyra.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('The lighthouse keeper is called Ilyra.', { exact: true })).toBeVisible()

  await page.evaluate(async () => {
    const token = localStorage.getItem('wayfarer-token') ?? ''
    const authorization = { authorization: `Bearer ${token}` }
    const search = await fetch('http://127.0.0.1:8792/api/campaign/search?q=lighthouse', { headers: authorization }).then((response) => response.json())
    await fetch('http://127.0.0.1:8792/api/campaign/canon/proposals', {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'character', title: 'Ilyra', claim: 'The lighthouse keeper is called Ilyra.',
        visibility: 'campaign', confidence: 0.94, extractorVersion: 'e2e-fixture-v1',
        sources: [{ messageId: search.results[0].id, excerpt: 'called Ilyra' }],
      }),
    })
  })

  await page.getByRole('button', { name: 'Canon' }).click()
  const ledger = page.getByRole('dialog', { name: 'Living canon ledger' })
  await expect(ledger.getByText('Ilyra', { exact: true })).toBeVisible()
  await expect(ledger.getByText('AI suggestion')).toBeVisible()
  await ledger.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(ledger.getByRole('heading', { name: 'Accepted canon' })).toBeVisible()
  await expect(ledger.getByText('Accepted by Mara')).toBeVisible()
  await ledger.getByRole('button', { name: 'Open citation from Mara in fireside' }).click()
  await expect(page.locator('.message--highlighted').getByText('The lighthouse keeper is called Ilyra.', { exact: true })).toBeVisible()
})
