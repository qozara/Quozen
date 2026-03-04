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
    chat(request: AgentChatRequest): Promise<AgentChatResponse>;
    checkAvailability(): Promise<boolean>;
    getSetupMessage(): string | null;
}

export interface AiFactoryConfig {
    providerPreference: 'auto' | 'byok' | 'local' | 'cloud' | 'disabled';
    encryptedApiKey?: string;
    baseUrl?: string; // e.g., Proxy URL or Ollama URL
    proxyUrl?: string;
}

export type AuthTokenGetter = () => string | null | Promise<string | null>;

