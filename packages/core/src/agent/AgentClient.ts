import { AgentChatRequest, AgentChatResponse } from './providers/types';

export class AgentClient {
    constructor(
        private baseUrl: string,
        private getAuthToken: () => string | null
    ) { }

    async encryptApiKey(apiKey: string): Promise<string> {
        const token = this.getAuthToken();
        if (!token) throw new Error('Authorization required');

        const response = await fetch(`${this.baseUrl}/api/v1/agent/encrypt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ apiKey })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({})) as { message?: string };
            throw new Error(error.message || 'Encryption failed');
        }

        const result = await response.json() as { ciphertext: string };
        return result.ciphertext;
    }

    async chat(request: AgentChatRequest): Promise<AgentChatResponse> {
        const token = this.getAuthToken();
        if (!token) throw new Error('Authorization required');

        const response = await fetch(`${this.baseUrl}/api/v1/agent/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({})) as { message?: string };
            throw new Error(error.message || 'AI request failed');
        }

        return await response.json() as AgentChatResponse;
    }
}
