export const agentTools = [
    {
        name: "addExpense",
        description: "Add a new expense to the group ledger. Use this when someone pays for something that should be shared.",
        parameters: {
            type: "object",
            properties: {
                description: { type: "string", description: "Short description of the expense" },
                amount: { type: "number", description: "Total amount of the expense" },
                category: { type: "string", description: "Expense category (e.g. food, transport, leisure, utilities)" },
                paidByUserId: { type: "string", description: "The name of the member who paid the bill" },
                splitStrategy: {
                    type: "string",
                    enum: ["equally_everyone", "equally_specific_members", "exact_amounts"],
                    description: "REQUIRED. Choose 'exact_amounts' if specific amounts are mentioned. Choose 'equally_specific_members' if splitting evenly among specific people. Choose 'equally_everyone' if splitting evenly among everyone."
                },
                specificMembers: {
                    type: "array",
                    items: { type: "string" },
                    description: "Names of members involved, used ONLY if splitStrategy is 'equally_specific_members'."
                },
                exactAmounts: {
                    type: "object",
                    description: "A map of member names to the exact amount they owe. Example: {\"Charlie\": 50}. REQUIRED if splitStrategy is 'exact_amounts'."
                }
            },
            required: ["description", "amount", "paidByUserId", "splitStrategy"]
        }
    },
    {
        name: "addSettlement",
        description: "Record a payment made from one member to another to settle debts.",
        parameters: {
            type: "object",
            properties: {
                fromUserId: { type: "string", description: "Name of the member who is paying" },
                toUserId: { type: "string", description: "Name of the member who receives the money" },
                amount: { type: "number", description: "Amount of money transferred" },
                method: { type: "string", description: "Method of payment (e.g. 'Cash', 'Bank Transfer', 'Venmo')" },
                notes: { type: "string", description: "Optional notes about the payment" }
            },
            required: ["fromUserId", "toUserId", "amount"]
        }
    },
    {
        name: "rejectRequest",
        description: "Use this tool to reject requests that are unrelated to adding expenses or settling debts (e.g., general knowledge questions, requests to delete groups, or vague statements).",
        parameters: {
            type: "object",
            properties: {
                reason: { type: "string", description: "The reason for rejecting the request or the answer to a conversational question." }
            },
            required: ["reason"]
        }
    }
];
