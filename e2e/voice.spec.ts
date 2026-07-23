import { expect, test } from '@playwright/test'

async function installSyntheticMicrophone(context: import('@playwright/test').BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const audio = new AudioContext()
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        const destination = audio.createMediaStreamDestination()
        gain.gain.value = 0.001
        oscillator.connect(gain).connect(destination)
        oscillator.start()
        return destination.stream
      },
    })
  })
}

test('two players connect, mute, and leave the voice table', async ({ browser, context, page }) => {
  await installSyntheticMicrophone(context)
  await page.goto('/')
  await page.getByLabel('Campaign name').fill('The Speaking Stones')
  await page.getByLabel('Your name').fill('Mara')
  await page.getByRole('button', { name: 'Open the table' }).click()
  await page.getByRole('button', { name: 'I saved my seat key' }).click()

  await page.getByRole('button', { name: 'Invite players' }).click()
  const invitation = page.getByRole('dialog', { name: 'The Speaking Stones' })
  const inviteUrl = await invitation.locator('.invite-link code').innerText()

  const guestContext = await browser.newContext()
  await installSyntheticMicrophone(guestContext)
  const guest = await guestContext.newPage()
  await guest.goto(inviteUrl)
  await guest.getByLabel('Your name').fill('Rowan')
  await guest.getByRole('button', { name: 'Join the table' }).click()
  await guest.getByRole('button', { name: 'I saved my seat key' }).click()
  await invitation.getByRole('complementary').getByLabel('Close invitation').click()

  const ownerVoice = page.getByRole('complementary', { name: 'Voice table' })
  const guestVoice = guest.getByRole('complementary', { name: 'Voice table' })
  await expect(ownerVoice.getByRole('button', { name: 'Join voice' })).toBeEnabled()
  await expect(guestVoice.getByRole('button', { name: 'Join voice' })).toBeEnabled()

  await ownerVoice.getByRole('button', { name: 'Join voice' }).click()
  await expect(ownerVoice.getByRole('heading', { name: '1 seated' })).toBeVisible({ timeout: 15_000 })
  await guestVoice.getByRole('button', { name: 'Join voice' }).click()

  await expect(ownerVoice.getByRole('heading', { name: '2 seated' })).toBeVisible()
  await expect(guestVoice.getByRole('heading', { name: '2 seated' })).toBeVisible()
  await expect(ownerVoice.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(guestVoice.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 })

  await guestVoice.getByRole('button', { name: 'Mute' }).click()
  await expect(ownerVoice.getByText('Muted · connected', { exact: true })).toBeVisible()

  await guestVoice.getByRole('button', { name: 'Leave voice' }).click()
  await expect(ownerVoice.getByRole('heading', { name: '1 seated' })).toBeVisible()
  await expect(ownerVoice.getByText('Rowan')).toHaveCount(0)
  await guestContext.close()
})
