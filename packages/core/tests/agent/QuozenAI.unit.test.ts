import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuozenAI } from '../../src/agent/QuozenAI';
import { AiProvider } from '../../src/agent/providers/types';
import { QuozenClient } from '../../src/QuozenClient';

describe('QuozenAI (Unit)', () => {
    let mockClient: any;
    let mockProvider: AiProvider;
    let ai: QuozenAI;

    beforeEach(() => {
        mockClient = {
            ledger: vi.fn().mockReturnValue({
                getLedger: vi.fn().mockResolvedValue({
                    members: [],
                    getBalances: () => ({})
                }),
                addExpense: vi.fn().mockResolvedValue({ success: true }),
                addSettlement: vi.fn().mockResolvedValue({ success: true })
            }),
            user: { id: 'u1', name: 'Alice' }
        };

        mockProvider = {
            id: 'test-provider',
            chat: vi.fn(),
            checkAvailability: vi.fn().mockResolvedValue(true),
            getSetupMessage: () => null
        };

        ai = new QuozenAI(mockClient as unknown as QuozenClient, mockProvider);
    });

    it('should execute a tool call returned by the provider', async () => {
        (mockProvider.chat as any).mockResolvedValue({
            type: 'tool_call',
            tool: 'addExpense',
            arguments: {
                description: 'Coffee',
                amount: 10,
                category: 'Food',
                paidByUserId: 'u1',
                splits: [{ userId: 'u1', amount: 10 }]
            }
        });

        const result = await ai.executeCommand('I paid 10 for coffee', 'group1');

        expect(result.success).toBe(true);
        expect(mockClient.ledger).toHaveBeenCalledWith('group1');
        expect(mockClient.ledger('group1').addExpense).toHaveBeenCalledWith(expect.objectContaining({
            description: 'Coffee',
            amount: 10
        }));
    });

    it('should return error if provider returns error', async () => {
        (mockProvider.chat as any).mockResolvedValue({
            type: 'text',
            error: 'AI is sleeping'
        });

        const result = await ai.executeCommand('hello', 'group1');

        expect(result.success).toBe(false);
        expect(result.message).toContain('AI is sleeping');
    });

    it('should handle unmatching tool names gracefully', async () => {
        (mockProvider.chat as any).mockResolvedValue({
            type: 'tool_call',
            tool: 'invalid_tool',
            arguments: {}
        });

        const result = await ai.executeCommand('invalid', 'group1');

        expect(result.success).toBe(false);
        expect(result.message).toContain('only help you add an expense');
    });

    it('should return error when LLM returns invalid JSON string arguments', async () => {
        (mockProvider.chat as any).mockResolvedValue({
            type: 'tool_call',
            tool: 'addExpense',
            arguments: '{"unclosed_json: true'
        });

        const result = await ai.executeCommand('buy coffee', 'group1');
        expect(result.success).toBe(false);
        expect(result.message).toContain('AI returned malformed arguments');
    });

    it('should return error when LLM tool execution fails (e.g. missing parameters)', async () => {
        (mockProvider.chat as any).mockResolvedValue({
            type: 'tool_call',
            tool: 'addExpense',
            arguments: { description: 'Coffee' } // Missing amount
        });

        // Mock ledger throwing error
        mockClient.ledger('group1').addExpense.mockRejectedValue(new Error("Missing required parameters"));

        const result = await ai.executeCommand('buy coffee', 'group1');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Missing required parameters');
    });
});
