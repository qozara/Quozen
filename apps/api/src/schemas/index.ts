import { z } from '@hono/zod-openapi';

export const MemberInputSchema = z.object({
    email: z.string().email().optional(),
    username: z.string().optional(),
}).openapi('MemberInput');

export const CreateGroupDTOSchema = z.object({
    name: z.string().describe('The name of the group').openapi({ example: 'Trip to Paris' }),
    members: z.array(MemberInputSchema).optional().describe('Initial members to invite to the group'),
}).openapi('CreateGroupRequest');

export const UpdateGroupDTOSchema = z.object({
    name: z.string().optional().describe('New name for the group').openapi({ example: 'Trip to Paris 2024' }),
    members: z.array(MemberInputSchema).optional().describe('Full list of members. This replaces the entire member list. CAUTION: Omitting this field will remove all members from the group.'),
}).openapi('UpdateGroupRequest');

export const GroupSchema = z.object({
    id: z.string().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    name: z.string().openapi({ example: 'Trip to Paris' }),
    description: z.string().openapi({ example: 'Google Sheet Group' }),
    createdBy: z.string().openapi({ example: 'me' }),
    participants: z.array(z.string()).openapi({ example: ['user1', 'user2'] }),
    createdAt: z.union([z.string(), z.date()]).openapi({ example: '2023-10-15T18:00:00Z' }),
    isOwner: z.boolean().openapi({ example: true }),
}).openapi('Group');

export const ExpenseSplitSchema = z.object({
    userId: z.string().openapi({ example: 'user-id-1' }),
    amount: z.number().openapi({ example: 25 }),
}).openapi('ExpenseSplit');

export const ExpenseSchema = z.object({
    id: z.string().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    description: z.string().openapi({ example: 'Dinner at Mario\'s' }),
    amount: z.number().openapi({ example: 50 }),
    category: z.string().openapi({ example: 'Food & Dining' }),
    date: z.union([z.string(), z.date()]).openapi({ example: '2023-10-15T18:00:00Z' }),
    paidByUserId: z.string().openapi({ example: 'user-id-1' }),
    splits: z.array(ExpenseSplitSchema),
    createdAt: z.union([z.string(), z.date()]).openapi({ example: '2023-10-15T18:00:00Z' }),
    updatedAt: z.union([z.string(), z.date()]).openapi({ example: '2023-10-15T18:00:00Z' }),
}).openapi('Expense');

export const CreateExpenseDTOSchema = z.object({
    description: z.string().describe('What the expense was for').openapi({ example: 'Dinner at Mario\'s' }),
    amount: z.number().describe('The total amount of the expense').openapi({ example: 50 }),
    category: z.string().describe('The category for tracking').openapi({ example: 'Food & Dining' }),
    date: z.string().describe('ISO 8601 date string').openapi({ example: '2023-10-15T18:00:00Z' }),
    paidByUserId: z.string().describe('The ID of the user who paid').openapi({ example: 'user-id-1' }),
    splits: z.array(ExpenseSplitSchema).optional().describe('AGENT INSTRUCTION: Omit this field to automatically split the cost equally among all group members.'),
}).openapi('CreateExpenseRequest');

export const UpdateExpenseDTOSchema = CreateExpenseDTOSchema.partial().extend({
    expectedLastModified: z.string().datetime().optional().describe('The timestamp of the last modification you know about. Used for Optimistic Concurrency Control. If you get a 409 Conflict, fetch the latest data and retry with the new timestamp.')
}).openapi('UpdateExpenseRequest');

export const SettlementSchema = z.object({
    id: z.string().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    date: z.union([z.string(), z.date()]).openapi({ example: '2023-10-15T18:00:00Z' }),
    fromUserId: z.string().openapi({ example: 'user-id-1' }),
    toUserId: z.string().openapi({ example: 'user-id-2' }),
    amount: z.number().openapi({ example: 25 }),
    method: z.string().openapi({ example: 'cash' }),
    notes: z.string().optional().openapi({ example: 'Thanks for dinner!' }),
}).openapi('Settlement');

export const CreateSettlementDTOSchema = z.object({
    date: z.string().optional().describe('ISO 8601 date string of the payment').openapi({ example: '2023-10-15T18:00:00Z' }),
    fromUserId: z.string().describe('The ID of the user who is paying').openapi({ example: 'user-id-1' }),
    toUserId: z.string().describe('The ID of the user being paid').openapi({ example: 'user-id-2' }),
    amount: z.number().describe('The amount paid').openapi({ example: 25 }),
    method: z.string().optional().describe('The payment method (e.g., cash, venmo, bank_transfer)').openapi({ example: 'cash' }),
    notes: z.string().optional().describe('Optional notes about the payment').openapi({ example: 'Thanks for dinner!' }),
}).openapi('CreateSettlementRequest');

export const UpdateSettlementDTOSchema = CreateSettlementDTOSchema.partial().openapi('UpdateSettlementRequest');

export const ErrorSchema = z.object({
    error: z.string(),
    message: z.string()
}).openapi('ErrorResponse');

export const SuccessSchema = z.object({
    success: z.boolean()
}).openapi('SuccessResponse');

export const LedgerAnalyticsSchema = z.object({
    balances: z.record(z.number()).describe('A map of userId to their current balance. Positive means they are owed money, negative means they owe money.'),
    totalVolume: z.number().describe('The total amount of all expenses in the group'),
    expenseCount: z.number().describe('The number of expense records'),
    settlementCount: z.number().describe('The number of settlement records'),
    memberCount: z.number().describe('The number of members in the group'),
    isBalanced: z.boolean().describe('Whether the sum of all balances is zero (should always be true)'),
}).openapi('LedgerAnalytics');
