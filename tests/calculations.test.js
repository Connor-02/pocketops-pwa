import test from "node:test";
import assert from "node:assert/strict";
import {
    dollarsToCents,
    calculateDashboardPeriod,
    suggestedStarterBudgets,
    scheduledIncomeForRange
} from "../public/calculations.js";

test("dollarsToCents parses safely to integer cents", () => {
    assert.equal(dollarsToCents("12.34"), 1234);
    assert.equal(dollarsToCents("$1,234.50"), 123450);
    assert.equal(dollarsToCents("12.345"), null);
});

test("suggested starter budgets reserve from unallocated by default", () => {
    const rows = suggestedStarterBudgets(200000, "fortnightly", [
        { key: "food", label: "Food", emoji: "x" }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reserveFromUnallocated, true);
    assert.equal(rows[0].category, "food");
});

test("dashboard period applies overspend to unallocated", () => {
    const result = calculateDashboardPeriod({
        transactions: [
            { type: "income", amountCents: 100000, date: "2026-02-10" },
            { type: "expense", amountCents: 15000, category: "food", date: "2026-02-10" }
        ],
        budgets: [{ category: "food", cycleBudgetCents: 10000, reserveFromUnallocated: true }],
        bills: [],
        appState: { payCycle: "weekly", customCategories: [{ key: "food", label: "Food", emoji: "x" }] },
        nowDate: new Date("2026-02-12"),
        period: "week"
    });

    assert.equal(result.income, 100000);
    assert.equal(result.budget, 10000);
    assert.equal(result.spent, 15000);
    assert.equal(result.net, 85000);
    assert.equal(result.unallocated, 85000);
    assert.equal(result.discretionaryAvailable, 85000);
    assert.equal(result.alerts.length, 1);
});

test("scheduled income is counted from last payday anchor", () => {
    const start = new Date("2026-02-16T00:00:00"); // Monday
    const end = new Date("2026-02-22T23:59:59");   // Sunday
    const income = scheduledIncomeForRange(start, end, {
        payCycle: "weekly",
        incomePerCycleCents: 50000,
        lastPaydayISO: "2026-02-13", // previous Friday
        useScheduledIncome: true
    });
    assert.equal(income, 50000); // next Friday in this week
});

test("discretionary available is post-budget availability", () => {
    const result = calculateDashboardPeriod({
        transactions: [
            { type: "income", amountCents: 100000, date: "2026-02-10" },
            { type: "expense", amountCents: 10000, category: "food", date: "2026-02-10" }
        ],
        budgets: [{ category: "food", cycleBudgetCents: 50000, reserveFromUnallocated: true }],
        bills: [],
        appState: { payCycle: "weekly", customCategories: [{ key: "food", label: "Food", emoji: "x" }] },
        nowDate: new Date("2026-02-12"),
        period: "week"
    });
    assert.equal(result.unallocated, 50000);
    assert.equal(result.discretionaryAvailable, 50000);
    assert.equal(result.net, 90000);
});
