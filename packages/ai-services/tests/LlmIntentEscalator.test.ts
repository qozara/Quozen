import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmIntentEscalator } from '../src/LlmIntentEscalator';
import { AiProviderFactory } from '@quozen/core';

describe('LlmIntentEscalator Local Network Safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips local Ollama and passes enableLocalAi: false by default to prevent browser permission popups', async () => {
    const createProviderSpy = vi.spyOn(AiProviderFactory, 'createProvider').mockResolvedValue({
      id: 'mock-provider',
      mode: 'cloud',
      chat: vi.fn().mockResolvedValue({
        type: 'tool_call',
        tool: 'addExpense',
        arguments: {
          description: 'Dinner',
          amount: 50,
          paidByUserId: 'Alice',
          splitStrategy: 'equally_everyone'
        }
      }),
      checkAvailability: vi.fn().mockResolvedValue(true),
      getSetupMessage: () => null
    } as any);

    const escalator = new LlmIntentEscalator({
      proxyUrl: 'https://proxy.example.com',
      provider: 'ollama', // User configured provider='ollama', but enableLocalAi is omitted/false
      ollamaBaseUrl: 'http://localhost:11434/api'
    });

    await escalator.escalateCommand({
      input: 'dinner 50',
      locale: 'en',
      meName: 'Alice',
      memberNames: ['Alice', 'Bob'],
      categories: [{ id: 'food_dining', name: 'Food', description: 'Dining' }]
    });

    expect(createProviderSpy).toHaveBeenCalledTimes(1);
    const [configPassed] = createProviderSpy.mock.calls[0];

    // Assert: enableLocalAi is false, baseUrl is stripped, and preference is mapped to safe cloud
    expect(configPassed.enableLocalAi).toBe(false);
    expect(configPassed.baseUrl).toBeUndefined();
    expect(configPassed.providerPreference).toBe('cloud');
  });

  it('passes enableLocalAi: true and retains baseUrl when user explicitly enables local AI in preferences', async () => {
    const createProviderSpy = vi.spyOn(AiProviderFactory, 'createProvider').mockResolvedValue({
      id: 'mock-provider',
      mode: 'local',
      chat: vi.fn().mockResolvedValue({
        type: 'tool_call',
        tool: 'addExpense',
        arguments: {
          description: 'Gas',
          amount: 30,
          paidByUserId: 'Alice',
          splitStrategy: 'equally_everyone'
        }
      }),
      checkAvailability: vi.fn().mockResolvedValue(true),
      getSetupMessage: () => null
    } as any);

    const escalator = new LlmIntentEscalator({
      proxyUrl: 'https://proxy.example.com',
      provider: 'ollama',
      enableLocalAi: true, // User explicitly opted in!
      ollamaBaseUrl: 'http://localhost:11434/api'
    });

    await escalator.escalateCommand({
      input: 'gas 30',
      locale: 'en',
      meName: 'Alice',
      memberNames: ['Alice', 'Bob'],
      categories: [{ id: 'transportation', name: 'Transport', description: 'Fuel' }]
    });

    expect(createProviderSpy).toHaveBeenCalledTimes(1);
    const [configPassed] = createProviderSpy.mock.calls[0];

    expect(configPassed.enableLocalAi).toBe(true);
    expect(configPassed.baseUrl).toBe('http://localhost:11434/api');
    expect(configPassed.providerPreference).toBe('local');
  });
});
