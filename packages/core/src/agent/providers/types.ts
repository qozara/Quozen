export interface AgentChatRequest {
    messages: { role: string; content: string }[];
    systemPrompt: string;
    tools: any[];
}

export interface AgentChatResponse {
    type: 'text' | 'tool_call';
    content?: string;
    tool?: string;
    arguments?: any;
    error?: string;
}

export interface AiProvider {
    readonly id: string;
    readonly mode: 'byok' | 'cloud' | 'local-browser' | 'local-ollama' | 'disabled';
    chat(request: AgentChatRequest): Promise<AgentChatResponse>;
    checkAvailability(): Promise<boolean>;
    getSetupMessage(): string | null;
}

export interface AiFactoryConfig {
    providerPreference: 'auto' | 'byok' | 'local' | 'local-browser' | 'cloud' | 'disabled';
    encryptedApiKey?: string;
    baseUrl?: string; // e.g., Proxy URL or Ollama URL
    proxyUrl?: string;
    ollamaModel?: string;
    byokProvider?: string;
}

export type AuthTokenGetter = () => string | null | Promise<string | null>;

