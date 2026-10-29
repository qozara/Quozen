import { Ledger } from '../domain/Ledger';
import { Member, ExpenseSplit } from '../domain/models';
import { resolveCategory, DEFAULT_CATEGORY_ID } from '../domain/categories';
import { distributeAmount } from '../finance';
import { StandardCommandParser } from '../parser/StandardCommandParser';
import type {
  CommandDraftResult,
  ExpenseDraft,
  SettlementDraft,
  IIntentEscalator,
  SlotConfidence
} from '../parser/types';

function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function levenshtein(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: bn + 1 }, () => new Array(an + 1).fill(0));
  for (let i = 0; i <= an; i++) matrix[0][i] = i;
  for (let j = 0; j <= bn; j++) matrix[j][0] = j;
  for (let j = 1; j <= bn; j++) {
    for (let i = 1; i <= an; i++) {
      if (b.charAt(j - 1) === a.charAt(i - 1)) {
        matrix[j][i] = matrix[j - 1][i - 1];
      } else {
        matrix[j][i] = Math.min(
          matrix[j - 1][i - 1] + 1, // substitution
          matrix[j][i - 1] + 1,     // insertion
          matrix[j - 1][i] + 1      // deletion
        );
      }
    }
  }
  return matrix[bn][an];
}

export interface CommandDraftServiceConfig {
  parser?: StandardCommandParser;
  escalator?: IIntentEscalator;
}

export class CommandDraftService {
  private readonly parser: StandardCommandParser;
  private readonly escalator?: IIntentEscalator;

  constructor(config: CommandDraftServiceConfig = {}) {
    this.parser = config.parser ?? new StandardCommandParser();
    this.escalator = config.escalator;
  }

  async createDraft(options: {
    input: string;
    ledger: Ledger;
    activeAccountId: string;
    locale?: string;
    aiEnabled?: boolean;
    forceAi?: boolean;
  }): Promise<CommandDraftResult> {
    const { input, ledger, activeAccountId, locale = 'en', aiEnabled = true, forceAi = false } = options;
    const members = ledger.members || [];
    const meMember = members.find(m => m.userId === activeAccountId);
    const meName = meMember ? meMember.name : 'Me';

    // 1. Run deterministic parser
    let parsed = this.parser.parse(input, { locale });

    // 2. Member Gazetteer & Resolution Helper
    const ambiguities: string[] = [];
    const resolveMember = (token?: string): Member | undefined => {
      if (!token) return undefined;
      const cleanToken = stripAccents(token.trim().toLowerCase());
      if (cleanToken === 'me' || cleanToken === 'i' || cleanToken === 'yo' || cleanToken === 'myself') {
        return meMember || members.find(m => m.userId === activeAccountId);
      }

      // Priority 1: Exact full-name match (accent-stripped)
      const exactMatch = members.find(m => stripAccents(m.name.trim().toLowerCase()) === cleanToken);
      if (exactMatch) return exactMatch;

      // Priority 2: Exact first-name match if unique
      const firstNameMatches = members.filter(m => {
        const first = stripAccents(m.name.trim().toLowerCase()).split(/\s+/)[0];
        return first === cleanToken;
      });
      if (firstNameMatches.length === 1) return firstNameMatches[0];
      if (firstNameMatches.length > 1) {
        ambiguities.push(`ambiguous_member:${token}`);
        return undefined;
      }

      // Priority 3: Prefix match (e.g. "An" matching Ana, Anabel)
      if (cleanToken.length >= 2) {
        const prefixMatches = members.filter(m => {
          const first = stripAccents(m.name.trim().toLowerCase()).split(/\s+/)[0];
          return first.startsWith(cleanToken);
        });
        if (prefixMatches.length === 1) return prefixMatches[0];
        if (prefixMatches.length > 1) {
          ambiguities.push(`ambiguous_member:${token}`);
          return undefined;
        }
      }

      // Priority 4: Levenshtein distance <= 1 for tokens >= 4 characters
      if (cleanToken.length >= 4) {
        const fuzzyMatches = members.filter(m => {
          const first = stripAccents(m.name.trim().toLowerCase()).split(/\s+/)[0];
          return levenshtein(first, cleanToken) <= 1;
        });
        if (fuzzyMatches.length === 1) return fuzzyMatches[0];
        if (fuzzyMatches.length > 1) {
          ambiguities.push(`ambiguous_member:${token}`);
          return undefined;
        }
      }

      ambiguities.push(`unmatched_member:${token}`);
      return undefined;
    };

    // 3. Optional JIT LLM Escalation check
    let isAiEscalated = false;
    const shouldEscalate = (forceAi || parsed.intentConfidence === 'low' || ambiguities.length > 0) &&
      aiEnabled &&
      this.escalator !== undefined;

    if (shouldEscalate && this.escalator) {
      try {
        const escalated = await this.escalator.escalateCommand({
          input,
          locale,
          meName,
          memberNames: members.map(m => m.name),
          categories: (ledger.categories || []).map(c => ({ id: c.id, name: c.name, description: c.description }))
        });

        if (escalated) {
          isAiEscalated = true;
          parsed = { ...parsed, ...escalated };
          ambiguities.length = 0; // Clear ambiguities if escalated successfully
        }
      } catch (err) {
        if (forceAi) throw err;
        console.warn('[CommandDraftService] LLM Escalation failed gracefully:', err);
      }
    }

    // 4. Calculate final date
    const date = new Date();
    if (parsed.dateOffsetDays) {
      date.setDate(date.getDate() + parsed.dateOffsetDays);
    }

    let confidence: SlotConfidence = parsed.intentConfidence;

    // 5. Build Final Draft: Settlement vs Expense
    if (parsed.intent === 'settlement') {
      const fromMember = resolveMember(parsed.payerToken || 'me');
      const toMember = resolveMember(parsed.recipientToken);

      let settlementAmount = parsed.amount || 0;

      // Handle "settle up with X" full balance lookup
      if ((parsed.isSettleUpFullBalance || settlementAmount === 0) && toMember) {
        const fromId = fromMember?.userId || activeAccountId;
        const suggestion = ledger.getSettleUpSuggestion(fromId);
        if (suggestion && (suggestion.toUserId === toMember.userId || suggestion.fromUserId === toMember.userId)) {
          settlementAmount = suggestion.amount;
        } else {
          const balances = ledger.getBalances();
          const targetBal = balances[toMember.userId] || 0;
          if (targetBal > 0) {
            settlementAmount = targetBal;
          }
        }
      }

      if (settlementAmount <= 0) {
        confidence = 'low';
        ambiguities.push('missing_amount');
      }

      const settlementDraft: SettlementDraft = {
        fromUserId: fromMember?.userId || activeAccountId,
        toUserId: toMember?.userId || '',
        amount: settlementAmount,
        method: parsed.settlementMethod || 'cash',
        date,
        notes: parsed.description !== 'Settlement' ? parsed.description : undefined
      };

      if (ambiguities.length > 0) {
        confidence = 'low';
      }

      return {
        rawInput: parsed.rawInput,
        kind: 'settlement',
        settlementDraft,
        confidence,
        ambiguities,
        isAiEscalated
      };
    }

    // Kind === 'expense'
    const payerMember = resolveMember(parsed.payerToken || 'me');
    const paidByUserId = payerMember ? payerMember.userId : activeAccountId;

    const resolvedCat = resolveCategory(parsed.categoryHint || parsed.description, ledger.categories);
    const category = resolvedCat ? resolvedCat.id : (ledger.categories?.[0]?.id || DEFAULT_CATEGORY_ID);

    const totalAmount = parsed.amount || 0;
    if (totalAmount <= 0) {
      confidence = 'low';
      ambiguities.push('missing_amount');
    }

    // Compute splits for all group members
    let finalSplits: ExpenseSplit[] = [];
    const excludedIds = new Set(
      parsed.excludedTokens
        .map(t => resolveMember(t)?.userId)
        .filter((id): id is string => Boolean(id))
    );

    if (parsed.splitStrategy === 'exact_amounts' && parsed.exactAmountTokens.length > 0) {
      const explicitSplits = new Map<string, number>();
      for (const item of parsed.exactAmountTokens) {
        const m = resolveMember(item.memberToken);
        if (m) explicitSplits.set(m.userId, item.amount);
      }

      // Sum explicit splits
      let explicitSum = 0;
      for (const amt of explicitSplits.values()) explicitSum += amt;

      const payerAssigned = explicitSplits.get(paidByUserId);
      if (payerAssigned === undefined && totalAmount > explicitSum) {
        explicitSplits.set(paidByUserId, totalAmount - explicitSum);
      } else if (Math.abs(explicitSum - totalAmount) > 0.05 && totalAmount > 0) {
        ambiguities.push('split_sum_mismatch');
        confidence = 'low';
      }

      finalSplits = members.map(m => ({
        userId: m.userId,
        amount: explicitSplits.get(m.userId) || 0
      }));
    } else if (parsed.splitStrategy === 'equally_specific_members' && parsed.participantTokens.length > 0) {
      const selectedMembers = new Set<string>();
      for (const t of parsed.participantTokens) {
        const m = resolveMember(t);
        if (m) selectedMembers.add(m.userId);
      }
      // Ensure payer is included unless explicitly excluded
      if (!excludedIds.has(paidByUserId)) {
        selectedMembers.add(paidByUserId);
      }

      const activeMemberIds = Array.from(selectedMembers).filter(id => !excludedIds.has(id));
      const distributed = distributeAmount(totalAmount, activeMemberIds.length || 1);

      finalSplits = members.map(m => {
        const idx = activeMemberIds.indexOf(m.userId);
        return {
          userId: m.userId,
          amount: idx !== -1 ? distributed[idx] : 0
        };
      });
    } else {
      // Equally everyone (minus excluded members)
      const eligibleMembers = members.filter(m => !excludedIds.has(m.userId));
      const distributed = distributeAmount(totalAmount, eligibleMembers.length || 1);

      finalSplits = members.map(m => {
        const idx = eligibleMembers.findIndex(em => em.userId === m.userId);
        return {
          userId: m.userId,
          amount: idx !== -1 ? distributed[idx] : 0
        };
      });
    }

    if (ambiguities.length > 0) {
      confidence = 'low';
    }

    const expenseDraft: ExpenseDraft = {
      description: parsed.description,
      amount: totalAmount,
      category,
      date,
      paidByUserId,
      splits: finalSplits,
      splitStrategy: parsed.splitStrategy
    };

    return {
      rawInput: parsed.rawInput,
      kind: 'expense',
      expenseDraft,
      confidence,
      ambiguities,
      isAiEscalated
    };
  }
}
