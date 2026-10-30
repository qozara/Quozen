import {
  type AuthTokenGetter
} from '@qozara/ai-client';
import {
  AiProviderFactory,
  type QuozenAiFactoryConfig,
  type IIntentEscalator,
  type ParsedRawCommand,
  type ExpenseCategory,
  type SplitStrategyKind
} from '@quozen/core';
import { LruMemoryCache } from './cache/LruMemoryCache';
import { classifyAiError } from './errors';

export interface LlmIntentEscalatorConfig {
  proxyUrl: string;
  provider?: 'qozara-intelligence' | 'byok' | 'ollama' | 'window.ai' | 'auto';
  ciphertext?: string;
  enableLocalAi?: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  getAuthToken?: AuthTokenGetter;
  cache?: LruMemoryCache<string, Partial<ParsedRawCommand>> | null;
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
  private readonly cache: LruMemoryCache<string, Partial<ParsedRawCommand>> | null;

  constructor(private readonly config: LlmIntentEscalatorConfig) {
    this.cache = config.cache === null ? null : (config.cache ?? defaultGlobalCommandCache);
  }

  clearCache(): void {
    this.cache?.clear();
  }

  private mapPreference(provider?: string): QuozenAiFactoryConfig['providerPreference'] {
    switch (provider) {
      case 'byok':
        return 'byok';
      case 'ollama':
      case 'local':
        return 'local';
      case 'window.ai':
      case 'local-browser':
        return 'local-browser';
      case 'auto':
        return 'auto';
      case 'qozara-intelligence':
      case 'cloud':
      default:
        return 'cloud';
    }
  }

  async escalateCommand(options: {
    input: string;
    locale: string;
    meName: string;
    memberNames: string[];
    categories: Pick<ExpenseCategory, 'id' | 'name' | 'description'>[];
  }): Promise<Partial<ParsedRawCommand> | null> {
    const { input, locale, meName, memberNames, categories } = options;
    const cleanInput = input.trim();
    if (!cleanInput) return null;

    const cacheKey = `${cleanInput.toLowerCase()}|${locale}|${memberNames.join(',')}`;
    if (this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const isLocalAllowed = Boolean(this.config.enableLocalAi);
    let pref = this.mapPreference(this.config.provider);
    // If local was requested but not explicitly enabled, fall back to cloud to avoid probing localhost
    if (pref === 'local' && !isLocalAllowed) {
      pref = 'cloud';
    }

    const factoryConfig: QuozenAiFactoryConfig = {
      providerPreference: pref,
      enableLocalAi: isLocalAllowed,
      proxyUrl: this.config.proxyUrl,
      encryptedApiKey: this.config.ciphertext,
      baseUrl: isLocalAllowed ? this.config.ollamaBaseUrl : undefined,
      ollamaModel: this.config.ollamaModel
    };

    try {
      const provider = await AiProviderFactory.createProvider(factoryConfig, this.config.getAuthToken);

      const systemPrompt = `You are Quozen AI, an intent extraction assistant for an expense-sharing application.
Translate the user input into tool arguments for addExpense or addSettlement.
Members in this group:
${memberNames.map(n => `- ${n}${n === meName ? ' (this is YOU)' : ''}`).join('\n')}

Categories:
${categories.map(c => `- ${c.id}: ${c.name} (${c.description})`).join('\n')}

RULES:
1. Identify payer, amount, and item description. Do NOT perform penny math or split division.
2. If the user says "I" or "me", paidByUserId should be "${meName}".
3. Respect the user language: ${locale}.`;

      const response = await provider.chat({
        messages: [{ role: 'user', content: cleanInput }],
        tools: buildAgentTools(categories),
        systemPrompt
      });

      if (!response || response.error) {
        throw new Error(response?.error || 'Empty AI response');
      }

      let result: Partial<ParsedRawCommand> | null = null;

      if (response.type === 'tool_call' && response.tool && response.arguments) {
        let args = response.arguments;
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { return null; }
        }

        const toolName = response.tool.toLowerCase();
        if (toolName === 'addexpense') {
          const splitStrategy: SplitStrategyKind =
            args.splitStrategy === 'exact_amounts' ? 'exact_amounts' :
            args.splitStrategy === 'equally_specific_members' ? 'equally_specific_members' : 'equally_everyone';

          const exactAmountTokens: Array<{ memberToken: string; amount: number }> = [];
          if (args.exactAmounts && typeof args.exactAmounts === 'object') {
            for (const [m, amt] of Object.entries(args.exactAmounts)) {
              exactAmountTokens.push({ memberToken: m, amount: Number(amt) || 0 });
            }
          }

          result = {
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
        } else if (toolName === 'addsettlement') {
          result = {
            intent: 'settlement',
            intentConfidence: 'high',
            amount: Number(args.amount) || 0,
            payerToken: args.fromUserId,
            recipientToken: args.toUserId,
            settlementMethod: args.method || 'cash',
            description: args.notes || 'Settlement'
          };
        }
      }

      if (result && this.cache) {
        this.cache.set(cacheKey, result);
      }

      return result;
    } catch (err) {
      throw classifyAiError(err);
    }
  }
}
