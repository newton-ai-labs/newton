import { expect, test } from '@playwright/test'

async function fix(request: import('@playwright/test').APIRequestContext, body: unknown) {
  const response = await request.post('/api/diagnostics/fix', {
    data: {
      provider: { provider: 'demo', model: 'demo' },
      ...body,
    },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<{
    fixedContent: string
    explanation: string
    changed: boolean
    kind: 'code-change' | 'manual-review' | 'unavailable'
  }>
}

test('diagnostics fix contract reports code changes explicitly', async ({ request }) => {
  const result = await fix(request, {
    diagnostic: {
      filePath: 'tmp/example.ts',
      line: 1,
      column: 14,
      severity: 'warning',
      message: 'Trailing whitespace',
      code: 'no-trailing-spaces',
      source: 'heuristic',
    },
    content: 'const value = 1   \n',
  })

  expect(result).toMatchObject({
    fixedContent: 'const value = 1\n',
    explanation: 'Removed trailing whitespace',
    changed: true,
    kind: 'code-change',
  })
})

test('diagnostics fix contract reports manual review explicitly', async ({ request }) => {
  const content = 'const value = 1 // TODO: remove temporary path\n'
  const result = await fix(request, {
    diagnostic: {
      filePath: 'tmp/example.ts',
      line: 1,
      column: 20,
      severity: 'warning',
      message: 'TODO: remove temporary path',
      code: 'TODO',
      source: 'heuristic',
    },
    content,
  })

  expect(result).toMatchObject({
    fixedContent: content,
    changed: false,
    kind: 'manual-review',
  })
  expect(result.explanation).toContain('manual review')
})

test('diagnostics fix contract reports unavailable fixes explicitly', async ({ request }) => {
  const content = 'const value = 1\n'
  const result = await fix(request, {
    diagnostic: {
      filePath: 'tmp/example.ts',
      line: 99,
      column: 1,
      severity: 'warning',
      message: 'Unknown diagnostic',
      source: 'heuristic',
    },
    content,
  })

  expect(result).toMatchObject({
    fixedContent: content,
    changed: false,
    kind: 'unavailable',
  })
})
