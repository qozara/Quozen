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
            return `- ${sanitizedName} (id: ${m.userId}${m.userId === me.id ? ', this is YOU' : ''})`;
        }).join('\n');

        const balances = ledger.getBalances();
        const balancesList = Object.entries(balances).map(([userId, amount]) => {
            const m = ledger.members.find((member: Member) => member.userId === userId);
            const name = m ? m.name : userId;
            const balanceAmount = amount as number;
            return `- ${name}: ${balanceAmount > 0 ? 'is owed' : 'owes'} ${Math.abs(balanceAmount)}`;
        }).join('\n');

        return `You are Quozen AI, an assistant for the Quozen app.
Your only job is to translate user requests into actions (addExpense or addSettlement).
Use the provided tools whenever a user mentions spending money, splitting bills, or paying debts.

Current context:
- Today: ${today}
- Active Group ID: ${activeGroupId}
- You are acting for: ${me.name} (id: ${me.id})
- Members in this group:
${membersList}

Current Balances:
${balancesList}

MANDATORY RULES:
1. Use 'addExpense' for spending (grocery, dinner, rent, etc.).
2. Use 'addSettlement' for payments between members (repaying, settling up, etc.).
3. If the user says "I paid", use paidByUserId: "${me.id}".
4. If splitting "among everyone", "between all", or the user doesn't specify how to split, omit the splits entirely. The system will automatically divide the amount equally among all ${ledger.members.length} members.
5. If the user mentions a member by name, map it to their ID from the list.
6. ONLY use tools if money, spending, or payment is explicitly mentioned.
7. Use 'addSettlement' when one member pays ANOTHER member (e.g. "Bob paid me", "I paid Alice back").
8. Use 'addExpense' only for external spending (e.g. "Paid for dinner", "Grocery shopping").
9. NEVER invent amounts or descriptions if not provided.
10. If you cannot fulfill the request with these tools, or it is vague, respond with a refusal message.
11. You must understand and reply in the following language: ${ctx.locale || 'en'}.`;
    }

    static validateResponse(response: any): { isValid: boolean; error?: string } {
        if (response.type === 'tool_call') {
            const validTools = ['addExpense', 'addSettlement'];
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
