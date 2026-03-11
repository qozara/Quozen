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
                
                // Pattern 1 & 2: { tool: "name", arguments: { ... } } or { action/type/tool_used: "name", ...args }
                const toolName = parsed.tool || parsed.action || parsed.type || parsed.tool_used;
                if (toolName) {
                    const args = parsed.arguments || { ...parsed };
                    // Remove the tool name from arguments if it was a flat structure
                    if (args === parsed) {
                        delete (args as any).tool;
                        delete (args as any).action;
                        delete (args as any).type;
                        delete (args as any).tool_used;
                    }
                    return {
                        type: 'tool_call',
                        tool: toolName as string,
                        arguments: args
                    };
                }

                // Pattern 3: { addExpense: { ... } } or { addSettlement: { ... } }
                const knownTools = ['addExpense', 'addSettlement'];
                for (const tool of knownTools) {
                    const key = Object.keys(parsed).find(k => k.toLowerCase() === tool.toLowerCase());
                    if (key) {
                        return {
                            type: 'tool_call',
                            tool: tool,
                            arguments: parsed[key]
                        };
                    }
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
