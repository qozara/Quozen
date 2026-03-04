import { AiProvider, AgentChatRequest, AgentChatResponse } from './types';

export class LocalOllamaProvider implements AiProvider {
    readonly id = 'local-ollama';
    private model: string;

    constructor(
        private baseUrl: string = 'http://localhost:11434/api',
        model: string = 'qwen2.5:0.5b'
    ) {
        this.model = model;
    }

    async chat(request: AgentChatRequest): Promise<AgentChatResponse> {
        try {
            const response = await fetch(`${this.baseUrl}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: request.systemPrompt },
                        ...request.messages
                    ],
                    stream: false,
                    format: 'json'
                })
            });

            if (!response.ok) {
                return { type: 'text', error: `Ollama failed (${response.status})` };
            }

            const data = await response.json() as any;
            const content = data.message?.content || '';

            try {
                const parsed = JSON.parse(content);
                if (parsed.tool && parsed.arguments) {
                    return {
                        type: 'tool_call',
                        tool: parsed.tool,
                        arguments: parsed.arguments
                    };
                }
                return { type: 'text', content };
            } catch {
                return { type: 'text', content };
            }
        } catch (error: any) {
            return { type: 'text', error: error.message || 'Local Ollama error' };
        }
    }

    async checkAvailability(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 2000);
            const tagsUrl = this.baseUrl.endsWith('/api') ? `${this.baseUrl}/tags` : `${this.baseUrl}/api/tags`;
            const response = await fetch(tagsUrl, { signal: controller.signal });
            clearTimeout(id);
            return response.ok;
        } catch {
            return false;
        }
    }

    getSetupMessage(): string | null {
        return "Note: Start Ollama with OLLAMA_ORIGINS=\"*\" ollama serve to allow browser connections.";
    }
}
