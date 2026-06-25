import { expect, test } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const fixtureDir = path.join(process.cwd(), 'playwright-fixtures')
const fixturePath = path.join(fixtureDir, 'ai-fix-preview.ts')
const fixtureRelPath = 'playwright-fixtures/ai-fix-preview.ts'
const fixtureContent = 'const value = 1 // TODO: remove temporary debug path\n'
const applyFixturePath = path.join(fixtureDir, 'ai-fix-apply.ts')
const applyFixtureContent = 'const value = 1   \n'
const applyFixtureFixedContent = 'const value = 1\n'

test.beforeEach(async () => {
  await mkdir(fixtureDir, { recursive: true })
  await writeFile(fixturePath, fixtureContent, 'utf8')
})

test.afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

test('AI Fix Preview opens from Problems and cancel leaves the file unchanged', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: /Problems & Diagnostics/ }).click()
  const fixtureGroup = problemGroup(page, 'ai-fix-preview.ts')

  await expect(fixtureGroup).toBeVisible()
  await fixtureGroup.getByRole('button', { name: /^Fix$/ }).click()

  await expect(page.getByText('No Automatic Fix Available')).toBeVisible()
  await expect(page.getByText(fixtureRelPath)).toBeVisible()
  await expect(page.getByText('This task marker needs manual review')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply Fix' })).toBeHidden()

  await page.locator('.modal-footer').getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('No Automatic Fix Available')).toBeHidden()
  await expect(await readFile(fixturePath, 'utf8')).toBe(fixtureContent)
})

test('applying an AI fix writes the file and refreshes Problems', async ({ page }) => {
  await writeFile(applyFixturePath, applyFixtureContent, 'utf8')
  await page.goto('/')

  await page.getByRole('button', { name: /Problems & Diagnostics/ }).click()
  const applyGroup = problemGroup(page, 'ai-fix-apply.ts')

  await expect(applyGroup).toBeVisible()
  await applyGroup.getByRole('button', { name: /^Fix$/ }).click()

  await expect(page.getByText('AI Fix Preview')).toBeVisible()
  await expect(page.getByText('Removed trailing whitespace')).toBeVisible()
  await page.getByRole('button', { name: 'Apply Fix' }).click()

  await expect(page.getByText('AI Fix Preview')).toBeHidden()
  await expect(applyGroup).toBeHidden()
  await expect(await readFile(applyFixturePath, 'utf8')).toBe(applyFixtureFixedContent)
})

function problemGroup(page: import('@playwright/test').Page, fileName: string) {
  return page
    .locator('.problems-file-group')
    .filter({ hasText: fileName })
    .filter({ hasText: 'playwright-fixtures' })
}
