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
  await expect(ledger.getByText('1 new transcript message ready to scan.')).toBeVisible()
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
  await expect(ledger.locator('.session-chapter-current').getByText('1 transcript message')).toBeVisible()
  await ledger.getByLabel('Session title').fill('Opening the lighthouse')
  await ledger.getByRole('button', { name: 'Close session' }).click()
  await expect(ledger.getByLabel('AI context session')).toContainText('Opening the lighthouse')
  await expect(ledger.getByText('The next transcript message will open a new session.')).toBeVisible()
  await expect(ledger.getByText('Explicit statements, commitments, and rulings can become canon.')).toBeVisible()
  await ledger.getByRole('button', { name: 'Revise policy' }).click()
  await ledger.getByLabel('What counts as canon?').selectOption('table_consensus')
  await ledger.getByLabel('Review default').selectOption('campaign')
  await ledger.getByLabel('Table-specific guidance').fill('Promises spoken in character count.')
  await ledger.getByRole('button', { name: 'Save constitution' }).click()
  await expect(ledger.getByText('Clear table consensus can become canon.')).toBeVisible()
  await expect(ledger.getByText('Promises spoken in character count.')).toBeVisible()
  await expect(ledger.getByText(/Revision 1 · Mara/)).toBeVisible()
  await ledger.getByRole('button', { name: 'Share with party' }).click()
  await expect(ledger.getByRole('heading', { name: 'Accepted canon' })).toBeVisible()
  await expect(ledger.getByText('Accepted by Mara')).toBeVisible()
  const evaluation = ledger.getByLabel('AI evaluation ledger')
  await expect(evaluation.locator('.evaluation-verdict').filter({ hasText: 'Canon rulings' }).getByText('100%', { exact: true })).toBeVisible()
  await expect(evaluation.getByText('1 judged', { exact: true })).toBeVisible()
  await expect(evaluation.getByText('e2e-fixture-v1', { exact: true })).toBeVisible()
  await expect(evaluation.getByText('Gathering evidence', { exact: true })).toBeVisible()
  await expect(evaluation.locator('.evaluation-surface')).toHaveCount(11)
  await expect(evaluation.locator('.evaluation-surface').filter({ hasText: 'Canon suggestions' }).getByText('Unconfigured', { exact: true })).toBeVisible()
  await expect(evaluation.locator('.evaluation-surface').filter({ hasText: 'Continuity brief' }).getByText('Untried', { exact: true })).toBeVisible()
  await ledger.getByRole('button', { name: 'Edit', exact: true }).click()
  await ledger.getByLabel('Canon title').fill('Ilyra, lighthouse keeper')
  await ledger.getByRole('button', { name: 'Save revision' }).click()
  await expect(ledger.getByText('Ilyra, lighthouse keeper', { exact: true })).toBeVisible()
  await ledger.getByRole('button', { name: 'History' }).click()
  await expect(ledger.getByText('Revision 1 · revised')).toBeVisible()
  await expect(ledger.getByText('Revision 0 · accepted')).toBeVisible()
  await ledger.getByRole('button', { name: 'Open citation from Mara in fireside' }).click()
  await expect(page.locator('.message--highlighted').getByText('The lighthouse keeper is called Ilyra.', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Table tools' }).click()
  const intelligence = page.getByRole('dialog', { name: 'Campaign intelligence' })
  await intelligence.getByLabel('Question').fill('Who keeps the lighthouse?')
  await intelligence.getByRole('button', { name: 'Ask from canon' }).click()
  await expect(intelligence.getByText('Ilyra is the lighthouse keeper.', { exact: true })).toBeVisible()
  await intelligence.getByLabel('What do you intend?').fill('Call the party onward.')
  await intelligence.getByRole('button', { name: 'Offer phrasings' }).click()
  await intelligence.getByRole('button', { name: 'Use in composer' }).first().click()
  await expect(page.getByLabel('Message fireside')).toHaveValue('I raise the lantern and call the party onward.')
  await page.getByRole('button', { name: 'Table tools' }).click()
  await page.getByRole('dialog', { name: 'Campaign intelligence' }).getByRole('button', { name: 'Opt in' }).click()
  await expect(page.getByRole('dialog', { name: 'Campaign intelligence' }).getByRole('button', { name: 'Revoke future counts' })).toBeVisible()
})
