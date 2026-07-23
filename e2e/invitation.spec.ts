import { expect, test } from '@playwright/test'

test('a player joins from the invitation sheet and receives broadcast text', async ({ browser, page }) => {
  await page.goto('/')
  await page.getByLabel('Campaign name').fill('The Lantern Road')
  await page.getByLabel('Your name').fill('Mara')
  await page.getByRole('button', { name: 'Open the table' }).click()

  await expect(page.getByRole('heading', { name: 'Save your seat key' })).toBeVisible()
  const seatKey = await page.locator('.seat-key code').innerText()
  await expect(page.getByRole('img', { name: "QR code for recovering Mara's seat" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Save your seat key' })).toBeVisible()
  await expect(page.locator('.seat-key code')).toHaveText(seatKey)
  await page.getByRole('button', { name: 'I saved my seat key' }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('wayfarer-pending-seat-entry'))).toBeNull()

  await page.getByRole('button', { name: 'Invite players' }).click()
  const invitation = page.getByRole('dialog', { name: 'The Lantern Road' })
  await expect(invitation.getByRole('img', { name: 'QR code to join The Lantern Road' })).toBeVisible()
  const inviteUrl = await invitation.locator('.invite-link code').innerText()
  expect(inviteUrl).toMatch(/^http:\/\/127\.0\.0\.1:5192\/\?campaign=[a-z0-9]{10}$/)

  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  await guest.goto(inviteUrl)
  await guest.getByLabel('Your name').fill('Rowan')
  await guest.getByRole('button', { name: 'Join the table' }).click()
  await expect(guest.getByRole('heading', { name: 'Save your seat key' })).toBeVisible()
  await guest.getByRole('button', { name: 'I saved my seat key' }).click()

  await expect(guest.getByLabel('Message fireside')).toBeEnabled()
  await guest.getByRole('button', { name: 'planning' }).click()
  await expect(guest.getByLabel('Message planning')).toBeEnabled()
  await invitation.getByRole('complementary').getByRole('button', { name: 'Close invitation' }).click()
  await page.getByLabel('Message fireside').fill('The lantern is lit.')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(guest.getByRole('button', { name: /fireside 1 unread message/ })).toBeVisible()
  await guest.getByRole('button', { name: /fireside 1 unread message/ }).click()
  await expect(guest.getByText('The lantern is lit.')).toBeVisible()
  await guestContext.close()
})
