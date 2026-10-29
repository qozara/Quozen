import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiProviderFactory } from '../../src/agent/providers/AiProviderFactory';
import { ProxyAiProvider } from '../../src/agent/providers/ProxyAiProvider';
import { WindowAiProvider } from '../../src/agent/providers/WindowAiProvider';
import { LocalOllamaProvider } from '../../src/agent/providers/LocalOllamaProvider';
import { DisabledAiProvider } from '../../src/agent/providers/AiProviderFactory';

describe('AiProviderFactory', () => {
    const mockGetToken = () => 'test-token';

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset global.window if needed
        (global as any).window = {};
    });

    it('should return ProxyAiProvider when preference is "cloud"', async () => {
        const provider = await AiProviderFactory.createProvider({
            providerPreference: 'cloud',
            proxyUrl: 'http://proxy'
        }, mockGetToken);

        expect(provider).toBeInstanceOf(ProxyAiProvider);
    });

    it('should return LocalOllamaProvider when preference is "local" AND enableLocalAi is true', async () => {
        const provider = await AiProviderFactory.createProvider({
            providerPreference: 'local',
            enableLocalAi: true,
            baseUrl: 'http://ollama'
        }, mockGetToken);

        expect(provider).toBeInstanceOf(LocalOllamaProvider);
    });

    it('should return DisabledAiProvider when preference is "local" but enableLocalAi is false/omitted', async () => {
        const provider = await AiProviderFactory.createProvider({
            providerPreference: 'local',
            baseUrl: 'http://ollama'
        }, mockGetToken);

        expect(provider).toBeInstanceOf(DisabledAiProvider);
    });

    it('should return WindowAiProvider when preference is "byok" (mocking window.ai)', async () => {
        const provider = await AiProviderFactory.createProvider({
            providerPreference: 'byok',
            encryptedApiKey: 'test-key',
            proxyUrl: 'http://proxy'
        }, mockGetToken);

        expect(provider).toBeInstanceOf(ProxyAiProvider);
    });

    it('should waterfall in "auto" mode: Proxy (BYOK) -> Window -> Local Ollama (only if enabled) -> Proxy (Team)', async () => {
        // 1. BYOK Case
        const p1 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            encryptedApiKey: 'key',
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p1).toBeInstanceOf(ProxyAiProvider);

        // 2. Window Case (No BYOK, Window available)
        (global as any).window = {
            ai: {
                languageModel: {
                    capabilities: async () => ({ available: 'readily' })
                }
            }
        };
        const p2 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p2).toBeInstanceOf(WindowAiProvider);

        // 3. Local Ollama Case: ONLY when enableLocalAi: true!
        (global as any).window = {};
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        const p3 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            enableLocalAi: true,
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p3).toBeInstanceOf(LocalOllamaProvider);

        // 4. In "auto" mode with enableLocalAi: false (DEFAULT): MUST skip Local Ollama and fall back to Proxy (Zero localhost probe!)
        mockFetch.mockClear();
        const p4 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            enableLocalAi: false,
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p4).toBeInstanceOf(ProxyAiProvider);
        expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('11434'), expect.anything());

        vi.unstubAllGlobals();
    });

    it('should handle getSetupMessage', () => {
        expect(AiProviderFactory.getSetupMessage('disabled')).toBeNull();
        expect(typeof AiProviderFactory.getSetupMessage('local')).toBe('string');
        expect(typeof AiProviderFactory.getSetupMessage('byok')).toBe('string');
    });
});
