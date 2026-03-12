import { User, Member } from "../domain/models";
import { Ledger } from "../domain/Ledger";

export interface OrchestratorContext {
    activeGroupId: string;
    me: User;
    ledger: Ledger;
    today?: string;
    locale?: string;
}

export class AgentOrchestrator {
    static buildSystemPrompt(ctx: OrchestratorContext): string {
        const { ledger, me, activeGroupId, today = new Date().toDateString() } = ctx;

        const membersList = ledger.members.map((m: Member) => {
            const sanitizedName = m.name.replace(/[\n\r]/g, ' ');
            return `- ${sanitizedName}${m.userId === me.id ? ' (this is YOU)' : ''}`;
        }).join('\n');

        const balances = ledger.getBalances();
        const balancesList = Object.entries(balances).map(([userId, amount]) => {
            const m = ledger.members.find((member: Member) => member.userId === userId);
            const name = m ? m.name : userId;
            const balanceAmount = amount as number;
            return `- ${name}: ${balanceAmount > 0 ? 'is owed' : 'owes'} ${Math.abs(balanceAmount)}`;
        }).join('\n');

        return `You are Quozen AI, an assistant for an expense tracking app called Quozen. The app allows to track expenses and settlements between members of a group, it allows expenses to be split equally or by exact amounts among selected group members.
Your only job is to translate user requests into actions (addExpense, addSettlement, or rejectRequest).
Use the provided tools whenever a user mentions spending money, splitting bills, or paying debts.

Current context:
- Today: ${today}
- Active Group ID: ${activeGroupId}
- You are acting for: ${me.name}
- Members in this group:
${membersList}

Current Balances:
${balancesList}

MANDATORY RULES:
1. Use 'addExpense' for spending (grocery, dinner, rent, etc.).
2. Use 'addSettlement' for payments between members (repaying, settling up, etc.).
3. If the user says "I paid", use paidByUserId: "${me.name}".
4. SPLITTING RULES (You MUST set 'splitStrategy'): 
   - "equally_everyone": The cost is shared equally among all members.
   - "equally_specific_members": The cost is shared equally, but only among the members listed in the 'specificMembers' array.
   - "exact_amounts": Used when specific monetary amounts are mentioned. You MUST provide the 'exactAmounts' object mapping names to amounts. Omit anyone who owes nothing.
   EXAMPLE: If user says "John did not participated, charlie owes me 50", you MUST set splitStrategy="exact_amounts" and provide exactAmounts={"Charlie": 50}.
5. Always use the exact names of the members as provided in the list. Do not use or invent IDs.
6. ONLY use tools if money, spending, or payment is explicitly mentioned.
7. Use 'addSettlement' when one member pays ANOTHER member (e.g. "Bob paid me", "I paid Alice back").
8. Use 'addExpense' only for external spending (e.g. "Paid for dinner", "Grocery shopping").
9. NEVER invent amounts or descriptions if not provided. Use the 'rejectRequest' tool instead.
10. If the request is a general question, asks to do something unsupported (like deleting a group), or is too vague, you MUST use the 'rejectRequest' tool.
11. You must understand and reply in the following language: ${ctx.locale || 'en'}.
12. The 'description' should be the specific item or place (e.g. 'Dinner', 'Uber'), NOT just the category name.`;
    }

    static validateResponse(response: any): { isValid: boolean; error?: string } {
        if (response.type === 'tool_call') {
            const validTools = ['addExpense', 'addSettlement', 'rejectRequest'];
            if (!validTools.includes(response.tool)) {
                return { isValid: false, error: "I'm sorry, I can only help you add an expense or record a settlement." };
            }
            return { isValid: true };
        }

        // If it's a text response, we consider it valid but it means no tool was called
        return { isValid: true };
    }

    static getErrorMessage(): string {
        return "I'm sorry, I can only help you add an expense or record a settlement.";
    }
}
