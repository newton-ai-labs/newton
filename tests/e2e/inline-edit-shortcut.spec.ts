import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function pressShortcut(page: Page, key: string) {
  await page.keyboard.down(modifier)
  await page.keyboard.press(`Key${key.toUpperCase()}`)
  await page.keyboard.up(modifier)
}

test('Cmd/Ctrl+K opens inline edit instead of the command palette', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: /Command Palette/ }).click()
  const paletteInput = page.getByPlaceholder(/Search files and commands/)
  await expect(paletteInput).toBeVisible()

  await paletteInput.fill('src/components/EditorArea.tsx')
  await page.keyboard.press('Enter')

  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible()
  await editor.click()

  await pressShortcut(page, 'k')

  await expect(page.getByPlaceholder(/Describe the edit/)).toBeVisible()
  await expect(paletteInput).toBeHidden()
})
