import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { AppEnv, authMiddleware } from '../middleware/auth.js';
import {
    GroupSchema, CreateGroupDTOSchema, UpdateGroupDTOSchema, ErrorSchema, SuccessSchema,
    LedgerAnalyticsSchema, ExpenseSchema, CreateExpenseDTOSchema, UpdateExpenseDTOSchema,
    SettlementSchema, CreateSettlementDTOSchema, UpdateSettlementDTOSchema
} from '../schemas/index.js';

export const groupsRouter = new OpenAPIHono<AppEnv>();

// Apply authentication middleware to all routes in this router
groupsRouter.use('*', authMiddleware);

const listGroupsRoute = createRoute({
    method: 'get',
    path: '/',
    operationId: 'listUserGroups',
    tags: ['Groups'],
    summary: 'List user groups',
    description: 'Retrieves all groups the authenticated user belongs to. AGENT INSTRUCTION: Call this first to discover the target `groupId` before performing any ledger, expense, or settlement operations.',
    responses: {
        200: {
            content: { 'application/json': { schema: z.array(GroupSchema) } },
            description: 'A list of groups',
        },
        401: {
            content: { 'application/json': { schema: ErrorSchema } },
            description: 'Unauthorized',
        },
    },
});

groupsRouter.openapi(listGroupsRoute, async (c) => {
    const quozen = c.get('quozen');
    const user = c.get('user');
    const settings = await quozen.groups.getSettings();
    // Convert cached groups to matching Group format if necessary, or fetch explicitly.
    // To adhere perfectly to the schema, we can map the cached groups.
    const mappedGroups = settings.groupCache.map(g => ({
        id: g.id,
        name: g.name,
        description: 'Google Sheet Group',
        createdBy: 'Unknown',
        participants: [],
        createdAt: g.lastAccessed || new Date().toISOString(),
        isOwner: g.role === 'owner'
    }));
    return c.json(mappedGroups, 200);
});

const createGroupRoute = createRoute({
    method: 'post',
    path: '/',
    operationId: 'createUserGroup',
    tags: ['Groups'],
    summary: 'Create a new group',
    description: 'Creates a new expense sharing group. You can optionally invite members via email or add offline users via username.',
    request: {
        body: {
            content: { 'application/json': { schema: CreateGroupDTOSchema } },
        },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: GroupSchema } },
            description: 'The created group',
        },
    },
});

groupsRouter.openapi(createGroupRoute, async (c) => {
    const body = c.req.valid('json');
    const quozen = c.get('quozen');
    const newGroup = await quozen.groups.create(body.name, body.members);
    return c.json(newGroup, 201);
});

const joinGroupRoute = createRoute({
    method: 'post',
    path: '/{id}/join',
    operationId: 'joinUserGroup',
    tags: ['Groups'],
    summary: 'Join an existing group',
    description: 'Joins an existing group via its ID. The file must already be shared with the user via Google Drive permissions.',
    request: {
        params: z.object({ id: z.string() }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: GroupSchema } },
            description: 'The joined group',
        },
    },
});

groupsRouter.openapi(joinGroupRoute, async (c) => {
    const id = c.req.valid('param').id;
    const quozen = c.get('quozen');
    const group = await quozen.groups.joinGroup(id);
    return c.json(group, 200);
});

const deleteGroupRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    operationId: 'deleteUserGroup',
    tags: ['Groups'],
    summary: 'Delete a group',
    description: 'Permanently deletes a group. Can only be performed by the group owner.',
    request: {
        params: z.object({ id: z.string() }),
    },
    responses: {
        204: { description: 'Group deleted successfully' },
    },
});

groupsRouter.openapi(deleteGroupRoute, async (c) => {
    const id = c.req.valid('param').id;
    const quozen = c.get('quozen');
    await quozen.groups.deleteGroup(id);
    return c.body(null, 204);
});

// ==========================================
// Group Edits
// ==========================================

const updateGroupRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    operationId: 'updateUserGroup',
    tags: ['Groups'],
    summary: 'Update a group',
    description: 'Updates group name and adds/removes members.',
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: UpdateGroupDTOSchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: SuccessSchema } }, description: 'Group updated' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' }
    }
});

groupsRouter.openapi(updateGroupRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const quozen = c.get('quozen');

    let nameToSet = body.name;
    if (!nameToSet) {
        const settings = await quozen.groups.getSettings();
        const group = settings.groupCache.find((g: any) => g.id === id);
        if (!group) return c.json({ error: 'Not Found', message: 'Group not found' }, 404);
        nameToSet = group.name;
    }

    await quozen.groups.updateGroup(id, nameToSet, body.members || []);
    return c.json({ success: true }, 200);
});

// ==========================================
// Ledger Analytics
// ==========================================

const getLedgerRoute = createRoute({
    method: 'get',
    path: '/{id}/ledger',
    operationId: 'getGroupLedgerAnalytics',
    tags: ['Analytics'],
    summary: 'Get ledger analytics and balances',
    description: 'Retrieves the financial summary and calculated balances of the group. AGENT INSTRUCTION: Use this endpoint to check who owes whom before suggesting or creating a settlement.',
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: LedgerAnalyticsSchema } }, description: 'Ledger Summary' }
    }
});

groupsRouter.openapi(getLedgerRoute, async (c) => {
    const id = c.req.valid('param').id;
    const quozen = c.get('quozen');
    const ledger = await quozen.ledger(id).getLedger();
    return c.json({
        ...ledger.getSummary(),
        balances: ledger.getBalances()
    }, 200);
});

// ==========================================
// Expenses CRUD
// ==========================================

const getExpensesRoute = createRoute({
    method: 'get',
    path: '/{id}/expenses',
    operationId: 'listGroupExpenses',
    tags: ['Expenses'],
    summary: 'Get all expenses',
    description: 'Retrieves the full history of expenses for the group. AGENT INSTRUCTION: This returns the entire unpaginated ledger history. It is safe to consume completely into context as the data structure is lightweight.',
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { content: { 'application/json': { schema: z.array(ExpenseSchema) } }, description: 'Expenses List' } }
});

groupsRouter.openapi(getExpensesRoute, async (c) => {
    const id = c.req.valid('param').id;
    const quozen = c.get('quozen');
    const expenses = await quozen.ledger(id).getExpenses();
    return c.json(expenses, 200);
});

const createExpenseRoute = createRoute({
    method: 'post',
    path: '/{id}/expenses',
    operationId: 'createGroupExpense',
    tags: ['Expenses'],
    summary: 'Create an expense',
    description: 'Creates a new expense. AGENT INSTRUCTION: If the user does not specify how to split the cost, simply omit the splits array and the system will automatically divide the amount equally among all members.',
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: CreateExpenseDTOSchema } } }
    },
    responses: { 201: { content: { 'application/json': { schema: ExpenseSchema } }, description: 'Created' } }
});

groupsRouter.openapi(createExpenseRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const quozen = c.get('quozen');
    const expense = await quozen.ledger(id).addExpense({
        ...body,
        date: new Date(body.date)
    });
    return c.json(expense, 201);
});

const updateExpenseRoute = createRoute({
    method: 'patch',
    path: '/{id}/expenses/{expId}',
    operationId: 'updateGroupExpense',
    tags: ['Expenses'],
    summary: 'Update an expense',
    description: 'Update an existing expense. AGENT INSTRUCTION (CONFLICT HANDLING): This endpoint uses Optimistic Concurrency Control. If you receive a 409 Conflict response, it means another user modified the expense while you were working. You MUST NOT resolve this automatically. Instead, inform the user of the conflict, show them the latest changes from listGroupExpenses, and ask how they would like to proceed.',
    request: {
        params: z.object({ id: z.string(), expId: z.string() }),
        body: { content: { 'application/json': { schema: UpdateExpenseDTOSchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: SuccessSchema } }, description: 'Updated successfully' },
        409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' }
    }
});

groupsRouter.openapi(updateExpenseRoute, async (c) => {
    const { id, expId } = c.req.valid('param');
    const body = c.req.valid('json');
    const quozen = c.get('quozen');
    try {
        await quozen.ledger(id).updateExpense(
            expId,
            { ...body, date: body.date ? new Date(body.date) : undefined },
            body.expectedLastModified ? new Date(body.expectedLastModified) : undefined
        );
        return c.json({ success: true }, 200);
    } catch (e: any) {
        if (e.name === 'ConflictError') return c.json({ error: 'Conflict', message: e.message }, 409);
        if (e.message.includes('not found') || e.name === 'NotFoundError') return c.json({ error: 'Not Found', message: e.message }, 404);
        throw e;
    }
});

const deleteExpenseRoute = createRoute({
    method: 'delete',
    path: '/{id}/expenses/{expId}',
    operationId: 'deleteGroupExpense',
    tags: ['Expenses'],
    summary: 'Delete an expense',
    description: 'Permanently deletes an expense from the ledger.',
    request: { params: z.object({ id: z.string(), expId: z.string() }) },
    responses: {
        204: { description: 'Deleted' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' }
    }
});

groupsRouter.openapi(deleteExpenseRoute, async (c) => {
    const { id, expId } = c.req.valid('param');
    const quozen = c.get('quozen');
    try {
        await quozen.ledger(id).deleteExpense(expId);
        return c.body(null, 204);
    } catch (e: any) {
        if (e.message.includes('not found') || e.name === 'NotFoundError') return c.json({ error: 'Not Found', message: e.message }, 404);
        throw e;
    }
});

// ==========================================
// Settlements CRUD
// ==========================================

const getSettlementsRoute = createRoute({
    method: 'get',
    path: '/{id}/settlements',
    operationId: 'listGroupSettlements',
    tags: ['Settlements'],
    summary: 'Get all settlements',
    description: 'Retrieves the full history of settlements (payments) for the group. AGENT INSTRUCTION: This returns the entire unpaginated history.',
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { content: { 'application/json': { schema: z.array(SettlementSchema) } }, description: 'Settlements List' } }
});

groupsRouter.openapi(getSettlementsRoute, async (c) => {
    const id = c.req.valid('param').id;
    const quozen = c.get('quozen');
    const settlements = await quozen.ledger(id).getSettlements();
    return c.json(settlements, 200);
});

const createSettlementRoute = createRoute({
    method: 'post',
    path: '/{id}/settlements',
    operationId: 'createGroupSettlement',
    tags: ['Settlements'],
    summary: 'Create a settlement',
    description: 'Records a payment between two users. AGENT INSTRUCTION: Always verify current debt using `getGroupLedgerAnalytics` before creating a settlement to ensure you are selecting the correct `fromUserId` (the person in debt) and `toUserId` (the person owed).',
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: CreateSettlementDTOSchema } } }
    },
    responses: { 201: { content: { 'application/json': { schema: SettlementSchema } }, description: 'Created' } }
});

groupsRouter.openapi(createSettlementRoute, async (c) => {
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const quozen = c.get('quozen');
    const settlement = await quozen.ledger(id).addSettlement({
        ...body,
        date: body.date ? new Date(body.date) : undefined
    });
    return c.json(settlement, 201);
});

const updateSettlementRoute = createRoute({
    method: 'patch',
    path: '/{id}/settlements/{settleId}',
    operationId: 'updateGroupSettlement',
    tags: ['Settlements'],
    summary: 'Update a settlement',
    description: 'Updates an existing settlement record.',
    request: {
        params: z.object({ id: z.string(), settleId: z.string() }),
        body: { content: { 'application/json': { schema: UpdateSettlementDTOSchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: SuccessSchema } }, description: 'Updated successfully' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' }
    }
});

groupsRouter.openapi(updateSettlementRoute, async (c) => {
    const { id, settleId } = c.req.valid('param');
    const body = c.req.valid('json');
    const quozen = c.get('quozen');
    try {
        await quozen.ledger(id).updateSettlement(
            settleId,
            { ...body, date: body.date ? new Date(body.date) : undefined }
        );
        return c.json({ success: true }, 200);
    } catch (e: any) {
        if (e.message.includes('not found') || e.name === 'NotFoundError') return c.json({ error: 'Not Found', message: e.message }, 404);
        throw e;
    }
});

const deleteSettlementRoute = createRoute({
    method: 'delete',
    path: '/{id}/settlements/{settleId}',
    operationId: 'deleteGroupSettlement',
    tags: ['Settlements'],
    summary: 'Delete a settlement',
    description: 'Deletes a settlement record.',
    request: { params: z.object({ id: z.string(), settleId: z.string() }) },
    responses: {
        204: { description: 'Deleted' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' }
    }
});

groupsRouter.openapi(deleteSettlementRoute, async (c) => {
    const { id, settleId } = c.req.valid('param');
    const quozen = c.get('quozen');
    try {
        await quozen.ledger(id).deleteSettlement(settleId);
        return c.body(null, 204);
    } catch (e: any) {
        if (e.message.includes('not found') || e.name === 'NotFoundError') return c.json({ error: 'Not Found', message: e.message }, 404);
        throw e;
    }
});
