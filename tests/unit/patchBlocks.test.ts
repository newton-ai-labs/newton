import { describe, it, expect } from 'vitest'
import { parsePatchBlocks, codeHasPatchBlocks } from '../../src/store'

describe('parsePatchBlocks (chat Apply patch format)', () => {
  it('parses a single SEARCH/REPLACE block', () => {
    const code = [
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'const x = 1',
      '=======',
      'const x = 100',
      '>>>>>>> REPLACE',
    ].join('\n')

    const blocks = parsePatchBlocks(code)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].path).toBe('src/foo.ts')
    expect(blocks[0].find).toBe('const x = 1')
    expect(blocks[0].replace).toBe('const x = 100')
  })

  it('parses multiple blocks in one chunk', () => {
    const code = [
      'src/a.ts',
      '<<<<<<< SEARCH',
      'foo',
      '=======',
      'bar',
      '>>>>>>> REPLACE',
      '',
      'src/b.ts',
      '<<<<<<< SEARCH',
      'baz',
      '=======',
      'qux',
      '>>>>>>> REPLACE',
    ].join('\n')

    const blocks = parsePatchBlocks(code)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].path).toBe('src/a.ts')
    expect(blocks[1].path).toBe('src/b.ts')
  })

  it('handles multi-line SEARCH and REPLACE bodies', () => {
    const code = [
      'src/multi.ts',
      '<<<<<<< SEARCH',
      'function foo() {',
      '  return 1',
      '}',
      '=======',
      'function foo() {',
      '  return 2',
      '}',
      '>>>>>>> REPLACE',
    ].join('\n')

    const blocks = parsePatchBlocks(code)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].find).toBe('function foo() {\n  return 1\n}')
    expect(blocks[0].replace).toBe('function foo() {\n  return 2\n}')
  })

  it('returns empty array when no blocks present', () => {
    expect(parsePatchBlocks('just some code\nconst x = 1')).toEqual([])
    expect(parsePatchBlocks('')).toEqual([])
  })

  it('codeHasPatchBlocks correctly detects presence', () => {
    expect(codeHasPatchBlocks('foo\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE')).toBe(true)
    expect(codeHasPatchBlocks('plain code')).toBe(false)
  })
})
