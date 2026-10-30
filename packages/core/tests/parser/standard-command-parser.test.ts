import { describe, it, expect } from 'vitest';
import { StandardCommandParser } from '../../src/parser/StandardCommandParser';

describe('StandardCommandParser (Golden Corpus)', () => {
  const parser = new StandardCommandParser();

  describe('1. Simple Equal Expenses (EN & ES)', () => {
    it('parses "Add $50 for gas"', () => {
      const res = parser.parse('Add $50 for gas', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(50);
      expect(res.categoryHint).toBe('transportation');
      expect(res.description.toLowerCase()).toContain('gas');
      expect(res.splitStrategy).toBe('equally_everyone');
    });

    it('parses "I paid 45.50 for dinner"', () => {
      const res = parser.parse('I paid 45.50 for dinner', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(45.5);
      expect(res.payerToken).toBe('me');
      expect(res.categoryHint).toBe('food_dining');
      expect(res.description.toLowerCase()).toContain('dinner');
      expect(res.splitStrategy).toBe('equally_everyone');
    });

    it('parses "Agrega 50 de gastos en comida para todos"', () => {
      const res = parser.parse('Agrega 50 de gastos en comida para todos', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(50);
      expect(res.categoryHint).toBe('food_dining');
      expect(res.splitStrategy).toBe('equally_everyone');
    });

    it('parses "Pagué 12.500 de asado"', () => {
      const res = parser.parse('Pagué 12.500 de asado', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(12500);
      expect(res.payerToken).toBe('me');
      expect(res.categoryHint).toBe('food_dining');
      expect(res.description.toLowerCase()).toContain('asado');
    });

    it('parses "Supermercado 8500"', () => {
      const res = parser.parse('Supermercado 8500', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(8500);
      expect(res.categoryHint).toBe('food_dining');
    });

    it('parses "Uber to airport 32"', () => {
      const res = parser.parse('Uber to airport 32', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(32);
      expect(res.categoryHint).toBe('transportation');
    });
  });

  describe('2. Third-Party Payer Expenses', () => {
    it('parses "Bob paid $80 for groceries"', () => {
      const res = parser.parse('Bob paid $80 for groceries', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(80);
      expect(res.payerToken?.toLowerCase()).toBe('bob');
      expect(res.categoryHint).toBe('food_dining');
    });

    it('parses "Alice pagó 4000 de taxi"', () => {
      const res = parser.parse('Alice pagó 4000 de taxi', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(4000);
      expect(res.payerToken?.toLowerCase()).toBe('alice');
      expect(res.categoryHint).toBe('transportation');
    });

    it('parses "Pagó Juan 3000 de estacionamiento"', () => {
      const res = parser.parse('Pagó Juan 3000 de estacionamiento', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(3000);
      expect(res.payerToken?.toLowerCase()).toBe('juan');
      expect(res.categoryHint).toBe('transportation');
    });
  });

  describe('3. Specific Member Splits & Exclusions', () => {
    it('parses "Split a $50 Uber with Bob"', () => {
      const res = parser.parse('Split a $50 Uber with Bob', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(50);
      expect(res.splitStrategy).toBe('equally_specific_members');
      expect(res.participantTokens.map(t => t.toLowerCase())).toContain('bob');
    });

    it('parses "I paid 90 for lunch with Alice and Bob"', () => {
      const res = parser.parse('I paid 90 for lunch with Alice and Bob', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(90);
      expect(res.splitStrategy).toBe('equally_specific_members');
      expect(res.participantTokens.map(t => t.toLowerCase())).toContain('alice');
      expect(res.participantTokens.map(t => t.toLowerCase())).toContain('bob');
    });

    it('parses "Cené con Alice y Charlie por 6000"', () => {
      const res = parser.parse('Cené con Alice y Charlie por 6000', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(6000);
      expect(res.splitStrategy).toBe('equally_specific_members');
      expect(res.participantTokens.map(t => t.toLowerCase())).toContain('alice');
      expect(res.participantTokens.map(t => t.toLowerCase())).toContain('charlie');
    });

    it('parses "120 for hotel for everyone except Bob"', () => {
      const res = parser.parse('120 for hotel for everyone except Bob', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(120);
      expect(res.excludedTokens.map(t => t.toLowerCase())).toContain('bob');
    });

    it('parses "6000 de pizza entre todos menos María"', () => {
      const res = parser.parse('6000 de pizza entre todos menos María', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(6000);
      expect(res.excludedTokens.map(t => t.toLowerCase())).toContain('maría');
    });
  });

  describe('4. Exact Amount Splits', () => {
    it('parses "Add $150 for dinner, I paid and bob owes me nothing, charlie owes me $50"', () => {
      const res = parser.parse('Add $150 for dinner, I paid and bob owes me nothing, charlie owes me $50', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(150);
      expect(res.splitStrategy).toBe('exact_amounts');
      expect(res.exactAmountTokens).toEqual([
        { memberToken: 'bob', amount: 0 },
        { memberToken: 'charlie', amount: 50 }
      ]);
    });

    it('parses "Pagué 100 de cena, Alice debe 30 y Bob debe 40"', () => {
      const res = parser.parse('Pagué 100 de cena, Alice debe 30 y Bob debe 40', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(100);
      expect(res.splitStrategy).toBe('exact_amounts');
      expect(res.exactAmountTokens).toEqual([
        { memberToken: 'Alice', amount: 30 },
        { memberToken: 'Bob', amount: 40 }
      ]);
    });
  });

  describe('5. Voice Dictation (STT) Numbers, Slang & Fillers', () => {
    it('parses "uh fifty dollars for coffee with Alice"', () => {
      const res = parser.parse('uh fifty dollars for coffee with Alice', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(50);
      expect(res.participantTokens.map(t => t.toLowerCase())).toContain('alice');
      expect(res.categoryHint).toBe('food_dining');
    });

    it('parses "eh bueno puse cinco lucas de nafta"', () => {
      const res = parser.parse('eh bueno puse cinco lucas de nafta', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(5000);
      expect(res.categoryHint).toBe('transportation');
    });

    it('parses "veinticinco con cincuenta de farmacia"', () => {
      const res = parser.parse('veinticinco con cincuenta de farmacia', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(25.5);
      expect(res.categoryHint).toBe('shopping');
    });

    it('parses "one hundred twenty bucks for concert tickets"', () => {
      const res = parser.parse('one hundred twenty bucks for concert tickets', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(120);
      expect(res.categoryHint).toBe('entertainment');
    });
  });

  describe('6. Relative Dates', () => {
    it('parses "I paid 40 for lunch yesterday"', () => {
      const res = parser.parse('I paid 40 for lunch yesterday', { locale: 'en' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(40);
      expect(res.dateOffsetDays).toBe(-1);
    });

    it('parses "Ayer pagué 3000 de cine con Ana"', () => {
      const res = parser.parse('Ayer pagué 3000 de cine con Ana', { locale: 'es' });
      expect(res.intent).toBe('expense');
      expect(res.amount).toBe(3000);
      expect(res.dateOffsetDays).toBe(-1);
      expect(res.participantTokens.map(t => t.toLowerCase())).toContain('ana');
    });
  });

  describe('7. Settlements & Settle-Up Balance Lookup', () => {
    it('parses "I just paid bob $20"', () => {
      const res = parser.parse('I just paid bob $20', { locale: 'en' });
      expect(res.intent).toBe('settlement');
      expect(res.amount).toBe(20);
      expect(res.payerToken).toBe('me');
      expect(res.recipientToken?.toLowerCase()).toBe('bob');
    });

    it('parses "Bob paid me 35 via Venmo"', () => {
      const res = parser.parse('Bob paid me 35 via Venmo', { locale: 'en' });
      expect(res.intent).toBe('settlement');
      expect(res.amount).toBe(35);
      expect(res.payerToken?.toLowerCase()).toBe('bob');
      expect(res.recipientToken).toBe('me');
      expect(res.settlementMethod).toBe('venmo');
    });

    it('parses "Le pagué 5000 a Alice por transferencia"', () => {
      const res = parser.parse('Le pagué 5000 a Alice por transferencia', { locale: 'es' });
      expect(res.intent).toBe('settlement');
      expect(res.amount).toBe(5000);
      expect(res.payerToken).toBe('me');
      expect(res.recipientToken?.toLowerCase()).toBe('alice');
      expect(res.settlementMethod).toBe('bank_transfer');
    });

    it('parses "Bob me devolvió 1500 en efectivo"', () => {
      const res = parser.parse('Bob me devolvió 1500 en efectivo', { locale: 'es' });
      expect(res.intent).toBe('settlement');
      expect(res.amount).toBe(1500);
      expect(res.payerToken?.toLowerCase()).toBe('bob');
      expect(res.recipientToken).toBe('me');
      expect(res.settlementMethod).toBe('cash');
    });

    it('parses "Settle up with Bob"', () => {
      const res = parser.parse('Settle up with Bob', { locale: 'en' });
      expect(res.intent).toBe('settlement');
      expect(res.isSettleUpFullBalance).toBe(true);
      expect(res.recipientToken?.toLowerCase()).toBe('bob');
    });

    it('parses "Saldar cuenta con Bob"', () => {
      const res = parser.parse('Saldar cuenta con Bob', { locale: 'es' });
      expect(res.intent).toBe('settlement');
      expect(res.isSettleUpFullBalance).toBe(true);
      expect(res.recipientToken?.toLowerCase()).toBe('bob');
    });
  });
});
