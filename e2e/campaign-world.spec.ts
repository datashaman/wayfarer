import { expect, test } from '@playwright/test'

test('a GM turns a premise into durable playable campaign material', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Campaign name').fill('The Salt Road')
  await page.getByLabel('Your name').fill('Mara')
  await page.getByRole('button', { name: 'Open the table' }).click()
  await page.getByRole('button', { name: 'I saved my seat key' }).click()

  await page.getByRole('button', { name: 'World' }).click()
  const folio = page.getByRole('dialog', { name: 'Campaign opening' })
  await folio.getByLabel('What is this campaign about?').fill('For seven nights, a drowned town returns beneath a moonless sky.')
  await folio.getByRole('button', { name: 'Draft a playable opening' }).click()

  await expect(folio.getByLabel('Campaign title')).toHaveValue('The Drowned Bell')
  await expect(folio.getByRole('heading', { name: 'Three truths' })).toBeVisible()
  await expect(folio.getByRole('heading', { name: 'Factions' })).toBeVisible()
  await expect(folio.getByRole('heading', { name: 'Locations' })).toBeVisible()
  await expect(folio.getByRole('heading', { name: 'Cast' })).toBeVisible()
  await expect(folio.getByRole('heading', { name: 'Hooks' })).toBeVisible()
  await expect(folio.getByLabel('The moment')).toHaveValue('The first toll')

  await folio.getByLabel('What the players are stepping into').fill('The drowned town has seven nights to settle every broken oath.')
  await folio.getByRole('button', { name: 'Establish campaign foundation' }).click()
  await expect(folio.getByText('Campaign foundation established. The table now has somewhere to begin.')).toBeVisible()
  await expect(folio.getByText('Foundation · revision 0')).toBeVisible()
  await folio.getByRole('button', { name: 'Close campaign opening' }).click()

  await page.getByRole('button', { name: 'World' }).click()
  const reopened = page.getByRole('dialog', { name: 'Campaign opening' })
  await expect(reopened.getByLabel('What the players are stepping into')).toHaveValue('The drowned town has seven nights to settle every broken oath.')
  await reopened.getByLabel('What changes if nobody acts').fill('At the seventh toll, the town and everyone inside vanish beneath the tide.')
  await reopened.getByRole('button', { name: 'Save campaign revision' }).click()
  await expect(reopened.getByText('Campaign foundation saved as revision 1.')).toBeVisible()
  await expect(reopened.getByText('Foundation · revision 1')).toBeVisible()
})
