import {
  LruMemoryCache,
  createGenAiToolResolver,
  normalizeProviderPreference,
  type AuthTokenGetter,
  type AiFactoryConfig,
  type GenAiToolResolver,
  type GenAiProviderPreference,
  type LegacyAiProviderPreference
} from '@qozara/ai-client';
import type {
  IIntentEscalator,
  ParsedRawCommand,
  ExpenseCategory,
  SplitStrategyKind
} from '@quozen/core';

export interface LlmIntentEscalatorConfig {
  proxyUrl: string;
  provider?: GenAiProviderPreference | LegacyAiProviderPreference;
  ciphertext?: string;
  byokProvider?: string;
  enableLocalAi?: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  getAuthToken?: AuthTokenGetter;
  cache?: LruMemoryCache<string, Partial<ParsedRawCommand>> | null;
}

export interface EscalateCommandOptions {
  input: string;
  locale: string;
  meName: string;
  memberNames: string[];
  categories: Pick<ExpenseCategory, 'id' | 'name' | 'description'>[];
}

const defaultGlobalCommandCache = new LruMemoryCache<string, Partial<ParsedRawCommand>>(50);

export function buildAgentTools(categories: Pick<ExpenseCategory, 'id' | 'name' | 'description'>[]) {
  const categoryIds = categories.map(c => c.id);
  const categoryDesc = categories.map(c => `${c.id} (${c.name})`).join(', ');

  return [
    {
      name: 'addExpense',
      description: 'Add a new expense to the group ledger. Use this when someone pays for something that should be shared.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Short description of the expense' },
          amount: { type: 'number', description: 'Total amount of the expense' },
          category: {
            type: 'string',
            enum: categoryIds,
            description: `Expense category ID. Choose from: ${categoryDesc}`
          },
          paidByUserId: { type: 'string', description: 'The name of the member who paid the bill' },
          splitStrategy: {
            type: 'string',
            enum: ['equally_everyone', 'equally_specific_members', 'exact_amounts'],
            description: "REQUIRED. Choose 'exact_amounts' if specific amounts are mentioned. Choose 'equally_specific_members' if splitting evenly among specific people. Choose 'equally_everyone' if splitting evenly among everyone."
          },
          specificMembers: {
            type: 'array',
            items: { type: 'string' },
            description: "Names of members involved, used ONLY if splitStrategy is 'equally_specific_members'."
          },
          exactAmounts: {
            type: 'object',
            description: 'A map of member names to the exact amount they owe. Example: {"Charlie": 50}. REQUIRED if splitStrategy is "exact_amounts".'
          }
        },
        required: ['description', 'amount', 'paidByUserId', 'splitStrategy']
      }
    },
    {
      name: 'addSettlement',
      description: 'Record a payment made from one member to another to settle debts.',
      parameters: {
        type: 'object',
        properties: {
          fromUserId: { type: 'string', description: 'Name of the member who is paying' },
          toUserId: { type: 'string', description: 'Name of the member who receives the money' },
          amount: { type: 'number', description: 'Amount of money transferred' },
          method: { type: 'string', description: "Method of payment (e.g. 'cash', 'bank_transfer', 'venmo')" },
          notes: { type: 'string', description: 'Optional notes about the payment' }
        },
        required: ['fromUserId', 'toUserId', 'amount']
      }
    }
  ];
}

export class LlmIntentEscalator implements IIntentEscalator {
  private readonly resolver: GenAiToolResolver<EscalateCommandOptions, Partial<ParsedRawCommand>>;

  constructor(config: LlmIntentEscalatorConfig) {
    const isLocalAllowed = Boolean(config.enableLocalAi);
    let pref = normalizeProviderPreference(config.provider);
    // If local was requested without explicit Local Network opt-in, fall back to cloud to avoid probing localhost
    if (pref === 'local' && !isLocalAllowed) {
      pref = 'cloud';
    }

    const factoryConfig: AiFactoryConfig = {
      providerPreference: pref,
      enableLocalAi: isLocalAllowed,
      proxyUrl: config.proxyUrl,
      encryptedApiKey: config.ciphertext,
      byokProvider: config.byokProvider,
      baseUrl: isLocalAllowed ? config.ollamaBaseUrl : undefined,
      ollamaModel: config.ollamaModel
    };

    const cache = config.cache === null ? null : (config.cache ?? defaultGlobalCommandCache);

    this.resolver = createGenAiToolResolver<EscalateCommandOptions, Partial<ParsedRawCommand>>({
      factoryConfig,
      getAuthToken: config.getAuthToken,
      cache,
      getCacheKey: (opts) =>
        `${opts.input.trim().toLowerCase()}|${opts.locale}|${opts.memberNames.join(',')}`,
      buildRequest: (opts) => {
        const systemPrompt = `You are Quozen AI, an intent extraction assistant for an expense-sharing application.
Translate the user input into tool arguments for addExpense or addSettlement.
Members in this group:
${opts.memberNames.map(n => `- ${n}${n === opts.meName ? ' (this is YOU)' : ''}`).join('\n')}

Categories:
${opts.categories.map(c => `- ${c.id}: ${c.name} (${c.description})`).join('\n')}

RULES:
1. Identify payer, amount, and item description. Do NOT perform penny math or split division.
2. If the user says "I" or "me", paidByUserId should be "${opts.meName}".
3. Respect the user language: ${opts.locale}.`;

        return {
          messages: [{ role: 'user', content: opts.input.trim() }],
          tools: buildAgentTools(opts.categories),
          systemPrompt
        };
      },
      parseResponse: (extracted) => {
        if (!extracted || !extracted.toolName || !extracted.args) {
          return null;
        }

        const args = extracted.args;
        const toolName = extracted.toolName.toLowerCase();

        if (toolName === 'addexpense') {
          const splitStrategy: SplitStrategyKind =
            args.splitStrategy === 'exact_amounts'
              ? 'exact_amounts'
              : args.splitStrategy === 'equally_specific_members'
              ? 'equally_specific_members'
              : 'equally_everyone';

          const exactAmountTokens: Array<{ memberToken: string; amount: number }> = [];
          if (args.exactAmounts && typeof args.exactAmounts === 'object') {
            for (const [m, amt] of Object.entries(args.exactAmounts)) {
              exactAmountTokens.push({ memberToken: m, amount: Number(amt) || 0 });
            }
          }

          return {
            intent: 'expense',
            intentConfidence: 'high',
            amount: Number(args.amount) || 0,
            description: args.description || 'Expense',
            categoryHint: args.category,
            payerToken: args.paidByUserId,
            splitStrategy,
            participantTokens: Array.isArray(args.specificMembers) ? args.specificMembers : [],
            exactAmountTokens
          };
        }

        if (toolName === 'addsettlement') {
          return {
            intent: 'settlement',
            intentConfidence: 'high',
            amount: Number(args.amount) || 0,
            payerToken: args.fromUserId,
            recipientToken: args.toUserId,
            settlementMethod: args.method || 'cash',
            description: args.notes || 'Settlement'
          };
        }

        return null;
      }
    });
  }

  clearCache(): void {
    this.resolver.clearCache();
  }

  async escalateCommand(options: EscalateCommandOptions): Promise<Partial<ParsedRawCommand> | null> {
    if (!options.input || !options.input.trim()) {
      return null;
    }
    return await this.resolver.resolve(options);
  }
}
