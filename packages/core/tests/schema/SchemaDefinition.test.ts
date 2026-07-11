import { describe, it, expect } from "vitest";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";

describe("QuozenSchema Validation Definitions", () => {
    it("should mark essential Expense columns as required", () => {
        const expensesTab = QuozenSchema.tabs.find(t => t.name === "Expenses");
        expect(expensesTab).toBeDefined();
        
        const requiredColumns = ["id", "date", "description", "amount", "paidBy", "category", "splits"];
        
        requiredColumns.forEach(colName => {
            const column = expensesTab!.columns.find(c => c.name === colName);
            expect(column).toBeDefined();
            expect(column!.required, `Column ${colName} should be required to prevent out-of-sync bugs`).toBe(true);
        });
        
        // meta is optional
        const metaColumn = expensesTab!.columns.find(c => c.name === "meta");
        expect(metaColumn!.required).toBeFalsy();
    });

    it("should mark essential Settlement columns as required", () => {
        const settlementsTab = QuozenSchema.tabs.find(t => t.name === "Settlements");
        expect(settlementsTab).toBeDefined();
        
        const requiredColumns = ["id", "date", "fromUserId", "toUserId", "amount", "method"];
        
        requiredColumns.forEach(colName => {
            const column = settlementsTab!.columns.find(c => c.name === colName);
            expect(column).toBeDefined();
            expect(column!.required, `Column ${colName} should be required`).toBe(true);
        });
        
        const notesColumn = settlementsTab!.columns.find(c => c.name === "notes");
        expect(notesColumn!.required).toBeFalsy();
    });

    it("should mark essential Member columns as required", () => {
        const membersTab = QuozenSchema.tabs.find(t => t.name === "Members");
        expect(membersTab).toBeDefined();
        
        const requiredColumns = ["userId", "name", "role", "joinedAt"];
        
        requiredColumns.forEach(colName => {
            const column = membersTab!.columns.find(c => c.name === colName);
            expect(column).toBeDefined();
            expect(column!.required, `Column ${colName} should be required`).toBe(true);
        });
        
        const emailColumn = membersTab!.columns.find(c => c.name === "email");
        expect(emailColumn!.required).toBeFalsy();
    });
});
