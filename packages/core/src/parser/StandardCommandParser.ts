import type {
  ParserLocalePack,
  ParsedRawCommand,
  CommandIntentKind,
  SplitStrategyKind,
  SettlementMethodKind,
  SlotConfidence
} from './types';
import { enLocalePack } from './locales/en';
import { esLocalePack } from './locales/es';

function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export class StandardCommandParser {
  private readonly packs = new Map<string, ParserLocalePack>();

  constructor(defaultPacks: ParserLocalePack[] = [esLocalePack, enLocalePack]) {
    for (const pack of defaultPacks) {
      this.registerLocalePack(pack);
    }
  }

  registerLocalePack(pack: ParserLocalePack): void {
    const key = pack.locale.toLowerCase().split('-')[0];
    this.packs.set(key, pack);
  }

  private resolvePack(input: string, locale?: string): ParserLocalePack {
    const reqKey = (locale || 'en').toLowerCase().split('-')[0];
    const configuredPack = this.packs.get(reqKey) || this.packs.get('en') || enLocalePack;

    const lower = input.toLowerCase();
    for (const [key, pack] of this.packs.entries()) {
      if (key === reqKey) continue;
      if (key === 'en' && /\b(?:i\s+paid|for|dinner|lunch|breakfast|split\s+with|between|groceries|dollars?|bucks?)\b/i.test(lower)) {
        return pack;
      }
      if (key === 'es' && /\b(?:pagu[eé]|gast[eé]|cena|almuerzo|comida|para\s+todos|con|asado|pesos?|lucas?|devolvi[oó]|transfer[ií])\b/iu.test(lower)) {
        return pack;
      }
    }

    return configuredPack;
  }

  parse(rawInput: string, options?: { locale?: string }): ParsedRawCommand {
    if (!rawInput || !rawInput.trim()) {
      return {
        rawInput: rawInput || '',
        detectedLocale: options?.locale || 'en',
        intent: 'expense',
        intentConfidence: 'low',
        participantTokens: [],
        excludedTokens: [],
        exactAmountTokens: [],
        splitStrategy: 'equally_everyone',
        dateOffsetDays: 0,
        description: ''
      };
    }

    const trimmed = rawInput.trim();
    const pack = this.resolvePack(trimmed, options?.locale);

    // 1. Strip leading voice fillers
    let text = trimmed.replace(pack.fillerWordsRegex, '').trim();

    // 2. Extract Relative Dates
    let dateOffsetDays = 0;
    for (const [dateKeyword, offset] of Object.entries(pack.relativeDates)) {
      const dateRegex = new RegExp(`\\b${dateKeyword}\\b`, 'iu');
      if (dateRegex.test(text)) {
        dateOffsetDays = offset;
        text = text.replace(dateRegex, ' ').trim();
        break;
      }
    }

    // 3. Check Settle-Up Balance Request
    const settleUpMatch = text.match(pack.settleUpBalanceRegex);
    if (settleUpMatch) {
      const targetToken = settleUpMatch[1].trim();
      return {
        rawInput: trimmed,
        detectedLocale: pack.locale,
        intent: 'settlement',
        intentConfidence: 'high',
        amount: undefined,
        isSettleUpFullBalance: true,
        payerToken: 'me',
        recipientToken: targetToken,
        participantTokens: [],
        excludedTokens: [],
        exactAmountTokens: [],
        splitStrategy: 'equally_everyone',
        dateOffsetDays,
        description: `Settle up with ${targetToken}`
      };
    }

    // 4. Extract Payment Method
    let settlementMethod: SettlementMethodKind | undefined;
    for (const [methodKeyword, methodKind] of Object.entries(pack.paymentMethods)) {
      const methodRegex = new RegExp(`\\b(?:via|by|por|en)?\\s*${methodKeyword}\\b`, 'iu');
      if (methodRegex.test(text)) {
        settlementMethod = methodKind;
        text = text.replace(methodRegex, ' ').trim();
        break;
      }
    }

    // 5. Parse Exact Amount Splits ("Charlie owes me 50", "Alice 30 y Bob 40", "50 de Charlie y 30 de Alice")
    const exactAmountTokens: Array<{ memberToken: string; amount: number }> = [];
    const exactOwesRegex = /\b([a-zA-Z0-9_\-]+)\s+(?:owes|debe)\s+(?:me\s+)?(?:nothing|nada|0)\b/giu;
    let exactOwesMatch;
    while ((exactOwesMatch = exactOwesRegex.exec(text)) !== null) {
      exactAmountTokens.push({ memberToken: exactOwesMatch[1], amount: 0 });
    }
    text = text.replace(exactOwesRegex, ' ').trim();

    const exactOwesAmountRegex = /\b([a-zA-Z0-9_\-]+)\s+(?:owes|debe)\s+(?:me\s+)?(?:[\$€£])?(\d+(?:[.,]\d+)?)\b/giu;
    while ((exactOwesMatch = exactOwesAmountRegex.exec(text)) !== null) {
      const amt = this.parseNumericValue(exactOwesMatch[2], pack);
      exactAmountTokens.push({ memberToken: exactOwesMatch[1], amount: amt });
    }
    text = text.replace(exactOwesAmountRegex, ' ').trim();

    // 6. Check Settlement Intent via patterns
    let detectedIntent: CommandIntentKind = 'expense';
    let settlementFrom: string | undefined;
    let settlementTo: string | undefined;

    for (const pattern of pack.settlementDirectionPatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        detectedIntent = 'settlement';
        settlementFrom = pattern.fromGroup === 'self' ? 'me' : match[pattern.fromGroup];
        settlementTo = pattern.toGroup === 'self' ? 'me' : match[pattern.toGroup];
        text = text.replace(pattern.regex, ' ').trim();
        break;
      }
    }

    // Secondary settlement trigger check (e.g. "Le pagué 5000 a Alice")
    if (detectedIntent !== 'settlement' && pack.settlementTriggerRegex.test(text)) {
      detectedIntent = 'settlement';
      settlementFrom = 'me';
      // Strip trigger word
      text = text.replace(pack.settlementTriggerRegex, ' ').trim();
    }

    // 7. Extract Main Numeric / Word Amount
    const { amount, remainingText } = this.extractPrimaryAmount(text, pack);
    text = remainingText;

    // 8. Extract Settlement Target if in "Le pagué a X" structure where amount was in between: "Le pagué 5000 a Alice"
    if (detectedIntent === 'settlement' && (!settlementTo || settlementTo === 'me')) {
      const toMatch = text.match(/^(?:a\s+)?([\p{L}_\-][\p{L}0-9_\-]*)/iu);
      if (toMatch && !pack.stopWords.has(toMatch[1].toLowerCase())) {
        settlementTo = toMatch[1];
        text = text.replace(toMatch[0], ' ').trim();
      }
    }

    // 9. Extract Payer for Expenses
    let payerToken: string | undefined = detectedIntent === 'settlement' ? settlementFrom : undefined;
    if (detectedIntent === 'expense') {
      for (const pattern of pack.payerPatterns) {
        const match = text.match(pattern.regex);
        if (match) {
          payerToken = pattern.groupIndex === 'self' ? 'me' : match[pattern.groupIndex];
          text = text.replace(pattern.regex, ' ').trim();
          break;
        }
      }
    }

    // 10. Extract Excluded Members ("except Bob", "sin Ana", "menos María")
    const excludedTokens: string[] = [];
    const exclRegex = new RegExp(`${pack.exclusionPrepositionsRegex.source}([\\p{L}0-9_\\-\\s,]+?)(?:$|\\b(?:for|para|in|en)\\b)`, 'iu');
    const exclMatch = text.match(exclRegex);
    if (exclMatch) {
      const rawExcl = exclMatch[1].trim();
      const names = rawExcl.split(/[,;\s]+(?:and|y)?\s*/).filter(Boolean);
      for (const name of names) {
        if (!pack.stopWords.has(name.toLowerCase())) {
          excludedTokens.push(name);
        }
      }
      text = text.replace(exclMatch[0], ' ').trim();
    }

    // 11. Extract Included Participants ("with Bob and Alice", "con Alice y Charlie", "entre todos")
    const participantTokens: string[] = [];
    let isEveryone = false;

    // Check if "for everyone" / "para todos" / "entre todos" appears in text
    if (Array.from(pack.everyoneWords).some(w => new RegExp(`\\b(?:for|para|entre)\\s+${w}\\b`, 'iu').test(text))) {
      isEveryone = true;
      for (const w of pack.everyoneWords) {
        text = text.replace(new RegExp(`\\b(?:for|para|entre)\\s+${w}\\b`, 'giu'), ' ').trim();
      }
    }

    const inclRegex = new RegExp(`${pack.inclusionPrepositionsRegex.source}([\\p{L}0-9_\\-\\s,]+?)(?:$|\\b(?:for|para|in|en)\\b)`, 'iu');
    const inclMatch = text.match(inclRegex);
    if (inclMatch) {
      const rawIncl = inclMatch[1].trim().toLowerCase();
      if (Array.from(pack.everyoneWords).some(w => rawIncl.includes(w))) {
        isEveryone = true;
      } else {
        const names = rawIncl.split(/[,;\s]+(?:and|y)?\s*/).filter(Boolean);
        for (const name of names) {
          if (pack.selfPronouns.has(name)) {
            participantTokens.push('me');
          } else if (!pack.stopWords.has(name) && !Array.from(pack.everyoneWords).some(w => w.includes(name))) {
            participantTokens.push(name);
          }
        }
      }
      text = text.replace(inclMatch[0], ' ').trim();
    }

    // 12. Split Strategy Inference
    let splitStrategy: SplitStrategyKind = 'equally_everyone';
    if (exactAmountTokens.length > 0) {
      splitStrategy = 'exact_amounts';
    } else if (participantTokens.length > 0 && !isEveryone) {
      splitStrategy = 'equally_specific_members';
    }

    // 13. Extract Category & Clean Description
    text = text.replace(pack.currencyNoiseRegex, ' ').replace(/\s+/g, ' ').trim();

    let categoryHint: string | undefined;
    const lowerTokens = stripAccents(text.toLowerCase()).split(/[\s,]+/);
    for (const token of lowerTokens) {
      if (token in pack.categoryKeywords) {
        categoryHint = pack.categoryKeywords[token];
        break;
      }
    }

    // Clean remaining tokens for description
    let description = text
      .replace(/^(?:for|para|de|in|en|a)\s+/iu, '')
      .replace(/\s+(?:for|para|de|in|en|a)$/iu, '')
      .trim();

    if (!description && categoryHint) {
      description = categoryHint.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    if (!description && detectedIntent === 'settlement') {
      description = settlementTo ? `Payment to ${settlementTo}` : 'Settlement';
    }
    if (!description) {
      description = 'Expense';
    } else {
      description = description.charAt(0).toUpperCase() + description.slice(1);
    }

    // 14. Confidence Scoring
    let confidence: SlotConfidence = 'high';
    if (amount === undefined || amount <= 0) {
      confidence = 'low';
    } else if (detectedIntent === 'settlement' && (!settlementTo || settlementTo === 'me')) {
      confidence = 'medium';
    } else if (description.length <= 2) {
      confidence = 'medium';
    }

    return {
      rawInput: trimmed,
      detectedLocale: pack.locale,
      intent: detectedIntent,
      intentConfidence: confidence,
      amount,
      payerToken,
      recipientToken: settlementTo,
      participantTokens,
      excludedTokens,
      exactAmountTokens,
      splitStrategy,
      categoryHint,
      settlementMethod,
      dateOffsetDays,
      description
    };
  }

  private parseNumericValue(val: string, pack: ParserLocalePack): number {
    let clean = val.trim();
    if (pack.locale === 'es') {
      // 1.500 or 15.000 -> 1500 / 15000
      if (/^\d{1,3}\.\d{3}$/.test(clean)) {
        clean = clean.replace('.', '');
      } else if (/^\d+,\d+$/.test(clean)) {
        clean = clean.replace(',', '.');
      }
    } else {
      // 1,500 -> 1500
      if (/^\d{1,3},\d{3}$/.test(clean)) {
        clean = clean.replace(',', '');
      }
    }
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }

  private extractPrimaryAmount(text: string, pack: ParserLocalePack): { amount?: number; remainingText: string } {
    let currentText = text;

    // Pattern A1: Digits with multiplier word (e.g. "15 lucas", "15k", "5 grand", "2 mil")
    const multKeys = Object.keys(pack.numberMultipliers).join('|');
    if (multKeys) {
      const digitWithMultRegex = new RegExp(`(?:[\\$€£]\\s*)?(\\d+(?:[.,]\\d+)?)\\s*(${multKeys})\\b`, 'iu');
      const digitWithMultMatch = currentText.match(digitWithMultRegex);
      if (digitWithMultMatch && digitWithMultMatch[1] && digitWithMultMatch[2]) {
        const rawNum = digitWithMultMatch[1];
        const multKey = digitWithMultMatch[2].toLowerCase();
        const mult = pack.numberMultipliers[multKey] || 1;
        const parsed = this.parseNumericValue(rawNum, pack) * mult;
        if (parsed > 0) {
          currentText = currentText.replace(digitWithMultMatch[0], ' ').trim();
          return { amount: parsed, remainingText: currentText };
        }
      }
    }

    // Pattern A: Standard digits with optional currency signs ($50, 45.50, 12.500, 3000)
    const digitMatch = currentText.match(/(?:[\$€£]\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:dollars?|bucks?|pesos?|usd|ars|mangos?))?/i);
    if (digitMatch && digitMatch[1]) {
      const rawNum = digitMatch[1];
      const parsed = this.parseNumericValue(rawNum, pack);
      if (parsed > 0) {
        currentText = currentText.replace(digitMatch[0], ' ').trim();
        return { amount: parsed, remainingText: currentText };
      }
    }

    // Pattern B: Number words & Multipliers (e.g. "cinco lucas" -> 5000, "one hundred twenty" -> 120, "veinticinco con cincuenta" -> 25.5)
    const words = currentText.toLowerCase().split(/\s+/);
    let accumulated = 0;
    let temp = 0;
    let matchedIndices: number[] = [];

    for (let i = 0; i < words.length; i++) {
      const w = stripAccents(words[i]);
      if (w in pack.numberWords) {
        temp += pack.numberWords[w];
        matchedIndices.push(i);
      } else if (w in pack.numberMultipliers) {
        const mult = pack.numberMultipliers[w];
        temp = (temp === 0 ? 1 : temp) * mult;
        accumulated += temp;
        temp = 0;
        matchedIndices.push(i);
      } else if (matchedIndices.length > 0 && (w === 'and' || w === 'con') && i + 1 < words.length) {
        const nextW = stripAccents(words[i + 1]);
        if (nextW in pack.numberWords) {
          // Check if "con cincuenta" (cents)
          if (w === 'con' && pack.locale === 'es') {
            const cents = pack.numberWords[nextW];
            temp += cents / 100;
            matchedIndices.push(i, i + 1);
            i++;
          }
        }
      } else if (matchedIndices.length > 0) {
        break;
      }
    }

    const totalWordAmount = accumulated + temp;
    if (totalWordAmount > 0 && matchedIndices.length > 0) {
      const filteredWords = words.filter((_, idx) => !matchedIndices.includes(idx));
      return { amount: totalWordAmount, remainingText: filteredWords.join(' ').trim() };
    }

    return { amount: undefined, remainingText: currentText };
  }
}
