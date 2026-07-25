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
    const token = JSON.parse(localStorage.getItem('wayfarer-saved-seats') ?? '[]')[0]?.token ?? ''
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
  const ledgerPanel = ledger.locator('.canon-ledger')
  const closeButton = ledgerPanel.getByRole('button', { name: 'Close canon ledger' })
  const [panelBox, closeBox] = await Promise.all([ledgerPanel.boundingBox(), closeButton.boundingBox()])
  expect(panelBox).not.toBeNull()
  expect(closeBox).not.toBeNull()
  expect(closeBox!.x).toBeGreaterThan(panelBox!.x + panelBox!.width - 60)
  expect(closeBox!.width).toBeGreaterThanOrEqual(34)
  expect(closeBox!.height).toBeGreaterThanOrEqual(34)
  await expect(ledger.getByText('Ilyra', { exact: true })).toBeVisible()
  await expect(ledger.getByText('AI suggestion')).toBeVisible()
  await ledger.getByRole('button', { name: 'Share with party' }).click()
  await expect(ledger.getByRole('heading', { name: 'Accepted canon' })).toBeVisible()
  await expect(ledger.getByText('Accepted by Mara')).toBeVisible()
  await ledger.getByRole('button', { name: 'Edit', exact: true }).click()
  await ledger.getByLabel('Canon title').fill('Ilyra, lighthouse keeper')
  await ledger.getByRole('button', { name: 'Save revision' }).click()
  await expect(ledger.getByText('Ilyra, lighthouse keeper', { exact: true })).toBeVisible()
  await ledger.getByRole('button', { name: 'History' }).click()
  await expect(ledger.getByText('Revision 1 · revised')).toBeVisible()
  await expect(ledger.getByText('Revision 0 · accepted')).toBeVisible()
  await ledger.getByRole('button', { name: 'Open citation from Mara in fireside' }).click()
  await expect(page.locator('.message--highlighted').getByText('The lighthouse keeper is called Ilyra.', { exact: true })).toBeVisible()
})
