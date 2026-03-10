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
                paidByUserId: { type: "string", description: "The ID of the member who paid the bill" },
            },
            required: ["description", "amount", "paidByUserId"]
        }
    },
    {
        name: "addSettlement",
        description: "Record a payment made from one member to another to settle debts.",
        parameters: {
            type: "object",
            properties: {
                fromUserId: { type: "string", description: "ID of the member who is paying" },
                toUserId: { type: "string", description: "ID of the member who receives the money" },
                amount: { type: "number", description: "Amount of money transferred" },
                method: { type: "string", description: "Method of payment (e.g. 'Cash', 'Bank Transfer', 'Venmo')" },
                notes: { type: "string", description: "Optional notes about the payment" }
            },
            required: ["fromUserId", "toUserId", "amount"]
        }
    }
];
