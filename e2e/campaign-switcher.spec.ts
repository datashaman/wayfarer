import { expect, test } from '@playwright/test'

async function openCampaign(page: import('@playwright/test').Page, campaignName: string, playerName: string) {
  await page.getByLabel('Campaign name').fill(campaignName)
  await page.getByLabel('Your name').fill(playerName)
  await page.getByRole('button', { name: 'Open the table' }).click()
  await page.getByRole('button', { name: 'I saved my seat key' }).click()
  await expect(page.getByRole('button', { name: 'Switch campaign' })).toContainText(campaignName)
}

test('a browser keeps seats for multiple campaigns and switches between them', async ({ page }) => {
  await page.goto('/')
  await openCampaign(page, 'The Lantern Road', 'Mara')
  const firstInvite = new URL(page.url()).searchParams.get('invite')

  await page.getByRole('button', { name: 'Switch campaign' }).click()
  await page.getByRole('menuitem', { name: 'Open new campaign' }).click()
  await expect(page.getByRole('heading', { name: 'Open a new campaign' })).toBeVisible()
  await expect(page.getByRole('button', { name: /The Lantern Road.*Mara/ })).toBeVisible()
  await openCampaign(page, 'The Glass Sea', 'Ilyra')

  await page.getByRole('button', { name: 'Switch campaign' }).click()
  const menu = page.getByRole('menu', { name: 'Saved campaigns' })
  await expect(menu.getByRole('menuitem')).toHaveCount(3)
  await menu.getByRole('menuitem', { name: /The Lantern Road.*Mara/ }).click()

  await expect(page.getByRole('button', { name: 'Switch campaign' })).toContainText('The Lantern Road')
  expect(new URL(page.url()).searchParams.get('invite')).toBe(firstInvite)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Switch campaign' })).toContainText('The Lantern Road')
})
