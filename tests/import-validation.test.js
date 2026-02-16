import test from "node:test";
import assert from "node:assert/strict";
import { validateImportPayload } from "../public/import-export.js";

test("import validation accepts a minimal valid payload", () => {
    const payload = {
        version: 2,
        appState: {
            payCycle: "fortnightly",
            incomePerCycleCents: 120000,
            customCategories: [{ key: "food", label: "Food", emoji: "x" }]
        },
        transactions: [
            { id: "a", type: "expense", amountCents: 1000, date: "2026-02-10" }
        ],
        budgets: [
            { category: "food", cycleBudgetCents: 10000, reserveFromUnallocated: true }
        ],
        bills: [
            { id: "b1", name: "Rent", amountCents: 40000, cycle: "fortnightly", category: "rent" }
        ],
        merchantMap: []
    };
    const result = validateImportPayload(payload);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
});

test("import validation rejects invalid structures with friendly errors", () => {
    const payload = {
        version: "2",
        appState: { payCycle: "daily", customCategories: [] },
        transactions: [{ id: "", type: "spend", amountCents: 12.5, date: "10-02-2026" }],
        budgets: [{ category: "", cycleBudgetCents: "x" }],
        bills: [{ id: "", name: "", amountCents: "bad", cycle: "yearly" }]
    };
    const result = validateImportPayload(payload);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
});
