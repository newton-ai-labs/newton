import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, migrateSettings, PROVIDER_REGISTRY } from '../../shared/types'

describe('DEFAULT_SETTINGS', () => {
  it('has demo as default provider', () => {
    expect(DEFAULT_SETTINGS.provider).toBe('demo')
  })

  it('has providerConfigs object', () => {
    expect(DEFAULT_SETTINGS.providerConfigs).toBeDefined()
    expect(typeof DEFAULT_SETTINGS.providerConfigs).toBe('object')
  })

  it('has reasonable font size default', () => {
    expect(DEFAULT_SETTINGS.fontSize).toBeGreaterThanOrEqual(10)
    expect(DEFAULT_SETTINGS.fontSize).toBeLessThanOrEqual(20)
  })
})

describe('migrateSettings', () => {
  it('returns defaults for empty object', () => {
    const result = migrateSettings({})
    expect(result.provider).toBe('demo')
    expect(result.fontSize).toBe(13)
  })

  it('preserves new format settings', () => {
    const settings = {
      provider: 'openai',
      providerConfigs: {
        openai: { model: 'gpt-4', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      },
      fontSize: 16,
    }
    const result = migrateSettings(settings)
    expect(result.provider).toBe('openai')
    expect(result.fontSize).toBe(16)
    expect(result.providerConfigs.openai.model).toBe('gpt-4')
  })

  it('migrates legacy openai settings', () => {
    const legacy = {
      provider: 'openai',
      openaiModel: 'gpt-3.5-turbo',
      openaiApiKey: 'sk-legacy',
    }
    const result = migrateSettings(legacy)
    expect(result.provider).toBe('openai')
    expect(result.providerConfigs.openai.model).toBe('gpt-3.5-turbo')
    expect(result.providerConfigs.openai.apiKey).toBe('sk-legacy')
  })

  it('migrates legacy anthropic settings', () => {
    const legacy = {
      provider: 'anthropic',
      anthropicModel: 'claude-2',
      anthropicApiKey: 'sk-ant-legacy',
    }
    const result = migrateSettings(legacy)
    expect(result.provider).toBe('anthropic')
    expect(result.providerConfigs.anthropic.model).toBe('claude-2')
    expect(result.providerConfigs.anthropic.apiKey).toBe('sk-ant-legacy')
  })

  it('migrates legacy ollama settings', () => {
    const legacy = {
      provider: 'ollama',
      ollamaModel: 'mistral',
      ollamaBaseUrl: 'http://localhost:11434',
    }
    const result = migrateSettings(legacy)
    expect(result.provider).toBe('ollama')
    expect(result.providerConfigs.ollama.model).toBe('mistral')
    expect(result.providerConfigs.ollama.baseUrl).toBe('http://localhost:11434')
  })
})

describe('PROVIDER_REGISTRY', () => {
  it('has at least demo provider', () => {
    const demo = PROVIDER_REGISTRY.find(p => p.id === 'demo')
    expect(demo).toBeDefined()
    expect(demo?.name).toContain('Demo')
  })

  it('all providers have required fields', () => {
    for (const provider of PROVIDER_REGISTRY) {
      expect(provider.id).toBeTruthy()
      expect(provider.name).toBeTruthy()
      expect(provider.models.length).toBeGreaterThan(0)
      expect(provider.protocol).toBeTruthy()
    }
  })

  it('openai-compat providers have correct protocol', () => {
    const openaiCompat = PROVIDER_REGISTRY.filter(p => p.protocol === 'openai-compat')
    expect(openaiCompat.length).toBeGreaterThan(0)
    // Most openai-compat providers need a key, but some local ones may not
    const needsKeyProviders = openaiCompat.filter(p => p.needsKey)
    expect(needsKeyProviders.length).toBeGreaterThan(0)
  })
})
