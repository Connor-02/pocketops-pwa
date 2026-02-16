import { APP_SCHEMA_VERSION, DEFAULT_APP_STATE, STARTER_CATEGORIES } from "./calculations.js";

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isISODate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function pushError(errors, msg) {
    errors.push(msg);
}

export function makeExportPayload(snapshot) {
    return {
        version: APP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        appState: {
            ...DEFAULT_APP_STATE,
            ...(snapshot?.appState || {})
        },
        transactions: asArray(snapshot?.transactions),
        budgets: asArray(snapshot?.budgets),
        bills: asArray(snapshot?.bills),
        merchantMap: asArray(snapshot?.merchantMap)
    };
}

export function validateImportPayload(payload) {
    const errors = [];
    if (!isObject(payload)) {
        pushError(errors, "Import must be a JSON object.");
        return { ok: false, errors };
    }

    if (typeof payload.version !== "number") {
        pushError(errors, "Missing or invalid `version`.");
    }

    if (!isObject(payload.appState)) {
        pushError(errors, "Missing `appState` object.");
    } else {
        const state = payload.appState;
        const payCycle = state.payCycle;
        if (!["weekly", "fortnightly", "monthly"].includes(payCycle)) {
            pushError(errors, "appState.payCycle must be weekly, fortnightly, or monthly.");
        }
        if (state.incomePerCycleCents != null && !Number.isInteger(state.incomePerCycleCents)) {
            pushError(errors, "appState.incomePerCycleCents must be an integer.");
        }
        if (state.customCategories != null) {
            if (!Array.isArray(state.customCategories) || state.customCategories.length === 0) {
                pushError(errors, "appState.customCategories must be a non-empty array.");
            }
        }
    }

    const transactions = asArray(payload.transactions);
    for (let i = 0; i < transactions.length; i += 1) {
        const tx = transactions[i];
        if (!isObject(tx)) {
            pushError(errors, `transactions[${i}] must be an object.`);
            continue;
        }
        if (!tx.id) pushError(errors, `transactions[${i}].id is required.`);
        if (!["income", "expense"].includes(tx.type)) pushError(errors, `transactions[${i}].type must be income or expense.`);
        if (!Number.isInteger(tx.amountCents)) pushError(errors, `transactions[${i}].amountCents must be an integer.`);
        if (!isISODate(tx.date)) pushError(errors, `transactions[${i}].date must be YYYY-MM-DD.`);
    }

    const budgets = asArray(payload.budgets);
    for (let i = 0; i < budgets.length; i += 1) {
        const b = budgets[i];
        if (!isObject(b)) {
            pushError(errors, `budgets[${i}] must be an object.`);
            continue;
        }
        if (!b.category) pushError(errors, `budgets[${i}].category is required.`);
        if (!Number.isInteger(Number(b.cycleBudgetCents || 0))) {
            pushError(errors, `budgets[${i}].cycleBudgetCents must be an integer.`);
        }
    }

    const bills = asArray(payload.bills);
    for (let i = 0; i < bills.length; i += 1) {
        const bill = bills[i];
        if (!isObject(bill)) {
            pushError(errors, `bills[${i}] must be an object.`);
            continue;
        }
        if (!bill.id) pushError(errors, `bills[${i}].id is required.`);
        if (!bill.name) pushError(errors, `bills[${i}].name is required.`);
        if (!Number.isInteger(Number(bill.amountCents || 0))) {
            pushError(errors, `bills[${i}].amountCents must be an integer.`);
        }
        if (!["weekly", "fortnightly", "monthly"].includes(bill.cycle)) {
            pushError(errors, `bills[${i}].cycle must be weekly, fortnightly, or monthly.`);
        }
    }

    return {
        ok: errors.length === 0,
        errors
    };
}

export function normalizeImportedPayload(payload) {
    const appState = {
        ...DEFAULT_APP_STATE,
        ...(payload.appState || {}),
        schemaVersion: APP_SCHEMA_VERSION
    };
    if (!Array.isArray(appState.customCategories) || appState.customCategories.length === 0) {
        appState.customCategories = STARTER_CATEGORIES;
    }
    return {
        appState,
        transactions: asArray(payload.transactions),
        budgets: asArray(payload.budgets),
        bills: asArray(payload.bills),
        merchantMap: asArray(payload.merchantMap)
    };
}
