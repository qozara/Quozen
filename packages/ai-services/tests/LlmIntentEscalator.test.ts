import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmIntentEscalator } from '../src/LlmIntentEscalator';
import { AiProviderFactory } from '../src';

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

  it('forwards getAuthToken and byokProvider to AiProviderFactory.createProvider', async () => {
    const createProviderSpy = vi.spyOn(AiProviderFactory, 'createProvider').mockResolvedValue({
      id: 'cloud-proxy',
      mode: 'cloud',
      chat: vi.fn().mockResolvedValue({
        type: 'tool_call',
        tool: 'addExpense',
        arguments: {
          description: 'Coffee',
          amount: 5,
          paidByUserId: 'Alice',
          splitStrategy: 'equally_everyone'
        }
      }),
      checkAvailability: vi.fn().mockResolvedValue(true),
      getSetupMessage: () => null
    } as any);

    const mockGetAuthToken = vi.fn().mockResolvedValue('google-oauth-token');

    const escalator = new LlmIntentEscalator({
      proxyUrl: 'https://ai.qozara.org',
      provider: 'auto',
      byokProvider: 'google',
      getAuthToken: mockGetAuthToken
    });

    await escalator.escalateCommand({
      input: 'coffee 5',
      locale: 'en',
      meName: 'Alice',
      memberNames: ['Alice', 'Bob'],
      categories: [{ id: 'food_dining', name: 'Food', description: 'Dining' }]
    });

    expect(createProviderSpy).toHaveBeenCalledTimes(1);
    expect(createProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        byokProvider: 'google'
      }),
      mockGetAuthToken
    );
  });
});
