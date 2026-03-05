import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index';

describe('API Concurrency', () => {
    let groupId: string;
    let expenseId: string;
    let initialLastModified: string;

    beforeAll(async () => {
        // Create a group
        const groupRes = await app.request('/api/v1/groups', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Concurrency Test Group' })
        });
        const groupData = await groupRes.json() as any;
        groupId = groupData.id;

        // Create an expense
        const expenseRes = await app.request(`/api/v1/groups/${groupId}/expenses`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: 'Original Dinner',
                amount: 100,
                category: 'Food',
                date: new Date().toISOString(),
                paidByUserId: 'u1',
                splits: [{ userId: 'u1', amount: 100 }]
            })
        });
        const expenseData = await expenseRes.json() as any;
        expenseId = expenseData.id;
        initialLastModified = expenseData.updatedAt;
    });

    it('PATCH /expenses/:id should return 409 Conflict when expectedLastModified < current', async () => {
        // First update to change the lastModified in the "database" (mock)
        await app.request(`/api/v1/groups/${groupId}/expenses/${expenseId}`, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: 'Updated Dinner' })
        });

        // Now try to update using the stale initialLastModified
        const res = await app.request(`/api/v1/groups/${groupId}/expenses/${expenseId}`, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: 'Stale Update',
                expectedLastModified: initialLastModified
            })
        });

        expect(res.status).toBe(409);
        const data = await res.json() as any;
        expect(data.error).toBe('Conflict');
    });

    it('PATCH /expenses/:id should succeed when expectedLastModified matches current', async () => {
        // Get current state to get the latest lastModified
        const getRes = await app.request(`/api/v1/groups/${groupId}/expenses`, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer mock-test-token' }
        });
        const expenses = await getRes.json() as any[];
        const currentExpense = expenses.find(e => e.id === expenseId);
        const currentLastModified = currentExpense.updatedAt;

        const res = await app.request(`/api/v1/groups/${groupId}/expenses/${expenseId}`, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: 'Valid Update',
                expectedLastModified: currentLastModified
            })
        });

        expect(res.status).toBe(200);
    });
});
