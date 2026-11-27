import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

const AUTH_HEADERS = {
    'Authorization': 'Bearer mock-test-token',
    'Content-Type': 'application/json',
};

describe('Groups Close / Re-open API', () => {
    it('enforces settled balances on close, supports force close, blocks CRUD with 409 when closed, and restores CRUD on reopen', async () => {
        // 1. Create group with a second member
        const createRes = await app.request('/api/v1/groups', {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({
                name: 'Close API Test Group',
                members: [{ username: 'bob' }],
            }),
        });
        expect(createRes.status).toBe(201);
        const group = (await createRes.json()) as any;
        expect(group.status).toBe('open');
        const groupId = group.id;

        // 2. Add expense -> creates non-zero balances
        const expRes = await app.request(`/api/v1/groups/${groupId}/expenses`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({
                description: 'Hotel',
                amount: 100,
                category: 'accommodation',
                date: new Date().toISOString(),
                paidByUserId: 'u1',
            }),
        });
        expect(expRes.status).toBe(201);
        const expense = (await expRes.json()) as any;

        // 3. Close without force -> 409 GroupNotSettledError with nonZeroBalances
        const rejectCloseRes = await app.request(`/api/v1/groups/${groupId}/close`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({}),
        });
        expect(rejectCloseRes.status).toBe(409);
        const rejectBody = (await rejectCloseRes.json()) as any;
        expect(rejectBody.error).toBe('GroupNotSettledError');
        expect(Object.keys(rejectBody.nonZeroBalances).length).toBeGreaterThan(0);

        // 4. Force close -> 200 { id, status: 'closed' }
        const forceCloseRes = await app.request(`/api/v1/groups/${groupId}/close`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({ force: true }),
        });
        expect(forceCloseRes.status).toBe(200);
        const closeBody = (await forceCloseRes.json()) as any;
        expect(closeBody).toEqual({ id: groupId, status: 'closed' });

        // 5. Ledger & group list reflect closed status
        const ledgerRes = await app.request(`/api/v1/groups/${groupId}/ledger`, {
            method: 'GET',
            headers: AUTH_HEADERS,
        });
        expect(ledgerRes.status).toBe(200);
        const ledgerBody = (await ledgerRes.json()) as any;
        expect(ledgerBody.status).toBe('closed');

        // 6. All write endpoints return 409 GroupClosedError while closed
        const addExpClosed = await app.request(`/api/v1/groups/${groupId}/expenses`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({
                description: 'Blocked',
                amount: 10,
                date: new Date().toISOString(),
                paidByUserId: 'u1',
            }),
        });
        expect(addExpClosed.status).toBe(409);
        expect(((await addExpClosed.json()) as any).error).toBe('GroupClosedError');

        const patchExpClosed = await app.request(`/api/v1/groups/${groupId}/expenses/${expense.id}`, {
            method: 'PATCH',
            headers: AUTH_HEADERS,
            body: JSON.stringify({ description: 'Blocked edit' }),
        });
        expect(patchExpClosed.status).toBe(409);

        const delExpClosed = await app.request(`/api/v1/groups/${groupId}/expenses/${expense.id}`, {
            method: 'DELETE',
            headers: AUTH_HEADERS,
        });
        expect(delExpClosed.status).toBe(409);

        const addSettleClosed = await app.request(`/api/v1/groups/${groupId}/settlements`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({
                fromUserId: 'bob',
                toUserId: 'u1',
                amount: 50,
            }),
        });
        expect(addSettleClosed.status).toBe(409);

        const patchGroupClosed = await app.request(`/api/v1/groups/${groupId}`, {
            method: 'PATCH',
            headers: AUTH_HEADERS,
            body: JSON.stringify({ name: 'Blocked Rename' }),
        });
        expect(patchGroupClosed.status).toBe(409);

        // 7. Reopen -> 200 { id, status: 'open' }
        const reopenRes = await app.request(`/api/v1/groups/${groupId}/reopen`, {
            method: 'POST',
            headers: AUTH_HEADERS,
        });
        expect(reopenRes.status).toBe(200);
        expect(await reopenRes.json()).toEqual({ id: groupId, status: 'open' });

        // 8. Settle up -> now close succeeds without force
        const settleRes = await app.request(`/api/v1/groups/${groupId}/settlements`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({
                fromUserId: 'bob',
                toUserId: 'u1',
                amount: 50,
            }),
        });
        expect(settleRes.status).toBe(201);

        const cleanCloseRes = await app.request(`/api/v1/groups/${groupId}/close`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: JSON.stringify({}),
        });
        expect(cleanCloseRes.status).toBe(200);
        expect(await cleanCloseRes.json()).toEqual({ id: groupId, status: 'closed' });
    });
});
