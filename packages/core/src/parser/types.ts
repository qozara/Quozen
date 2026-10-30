import type { ExpenseCategory, ExpenseCategoryId, ExpenseSplit } from '../domain/models';

export type CommandIntentKind = 'expense' | 'settlement';
export type SplitStrategyKind = 'equally_everyone' | 'equally_specific_members' | 'exact_amounts';
export type SettlementMethodKind = 'cash' | 'venmo' | 'paypal' | 'bank_transfer' | 'other';
export type SlotConfidence = 'high' | 'medium' | 'low';

export interface ParsedRawCommand {
  rawInput: string;
  detectedLocale: string;
  intent: CommandIntentKind;
  intentConfidence: SlotConfidence;
  amount?: number;
  isSettleUpFullBalance?: boolean; // e.g. "settle up with Bob", "saldar cuenta con Ana"
  payerToken?: string;             // 'me' | raw member name token
  recipientToken?: string;         // For settlements: 'me' | raw member name token
  participantTokens: string[];     // Included member name tokens
  excludedTokens: string[];        // Excluded member name tokens ("except Bob", "sin Ana")
  exactAmountTokens: Array<{ memberToken: string; amount: number }>;
  splitStrategy: SplitStrategyKind;
  categoryHint?: string;
  settlementMethod?: SettlementMethodKind;
  dateOffsetDays: number;          // 0 = today, -1 = yesterday/ayer, etc.
  explicitDateIso?: string;
  description: string;
}

export interface ExpenseDraft {
  description: string;
  amount: number;
  category: ExpenseCategoryId;
  date: Date;
  paidByUserId: string;
  splits: ExpenseSplit[];          // Always populated for all group members so ExpenseForm selects accurately
  splitStrategy: SplitStrategyKind;
}

export interface SettlementDraft {
  fromUserId: string;
  toUserId: string;
  amount: number;
  method: SettlementMethodKind;
  date: Date;
  notes?: string;
}

export interface CommandDraftResult {
  rawInput: string;
  kind: CommandIntentKind;
  expenseDraft?: ExpenseDraft;
  settlementDraft?: SettlementDraft;
  confidence: SlotConfidence;      // Overall confidence ('high' | 'medium' | 'low')
  ambiguities: string[];           // e.g. ["unmatched_member:charly", "missing_amount"]
  isAiEscalated: boolean;
}

export interface ParserLocalePack {
  readonly locale: string;
  readonly fillerWordsRegex: RegExp;
  readonly numberWords: Record<string, number>;
  readonly numberMultipliers: Record<string, number>; // e.g. hundred: 100, thousand/mil/lucas: 1000
  readonly currencyNoiseRegex: RegExp;                // $, usd, dollars, pesos, ars, euros, bucks, mangos
  readonly settlementTriggerRegex: RegExp;            // paid back, settled up, le pagué a, me transfirió, etc.
  readonly settleUpBalanceRegex: RegExp;              // settle up with, saldar con, quedar a mano con
  readonly selfPronouns: Set<string>;                 // i, me, myself, yo, mi, mí
  readonly everyoneWords: Set<string>;                // everyone, all, everybody, todos, todas
  readonly inclusionPrepositionsRegex: RegExp;        // split with, between, among, con, entre
  readonly exclusionPrepositionsRegex: RegExp;        // except, without, minus, menos, sin, excepto
  readonly payerPatterns: Array<{ regex: RegExp; groupIndex: number | 'self' }>;
  readonly settlementDirectionPatterns: Array<{
    regex: RegExp;
    fromGroup: number | 'self';
    toGroup: number | 'self';
  }>;
  readonly paymentMethods: Record<string, SettlementMethodKind>;
  readonly relativeDates: Record<string, number>;     // today/hoy: 0, yesterday/ayer: -1, anteayer: -2
  readonly categoryKeywords: Record<string, ExpenseCategoryId>;
  readonly stopWords: Set<string>;
}

export interface IIntentEscalator {
  escalateCommand(options: {
    input: string;
    locale: string;
    meName: string;
    memberNames: string[];
    categories: Pick<ExpenseCategory, 'id' | 'name' | 'description'>[];
  }): Promise<Partial<ParsedRawCommand> | null>;
}
