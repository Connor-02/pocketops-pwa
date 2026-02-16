export const APP_SCHEMA_VERSION = 2;

export const STARTER_CATEGORIES = [
    { key: "food", label: "Food", emoji: "🍜" },
    { key: "transport", label: "Transport", emoji: "🚌" },
    { key: "rent", label: "Rent", emoji: "🏠" },
    { key: "social", label: "Social", emoji: "🎉" },
    { key: "subscriptions", label: "Subscriptions", emoji: "📺" }
];

export const EXTRA_CATEGORIES = [
    { key: "groceries", label: "Groceries", emoji: "🛒" },
    { key: "takeaway", label: "Takeaway", emoji: "🍔" },
    { key: "coffee", label: "Coffee", emoji: "☕" },
    { key: "bills", label: "Bills", emoji: "🧾" },
    { key: "utilities", label: "Utilities", emoji: "💡" },
    { key: "phone", label: "Phone", emoji: "📱" },
    { key: "shopping", label: "Shopping", emoji: "🛍️" },
    { key: "health", label: "Health", emoji: "💊" },
    { key: "other", label: "Other", emoji: "✨" }
];

export const FALLBACK_CATEGORY = { key: "other", label: "Other", emoji: "✨" };

export const DEFAULT_APP_STATE = {
    key: "appState",
    schemaVersion: APP_SCHEMA_VERSION,
    onboardingCompleted: false,
    payCycle: "fortnightly",
    paydayISO: "",
    incomePerCycleCents: 0,
    recentCategories: [],
    customCategories: STARTER_CATEGORIES,
    suppressedSubscriptionKeys: [],
    pinEnabled: false,
    pinHash: ""
};

export function merchantKeyFrom(merchant) {
    return String(merchant || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function dollarsToCents(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.round(value * 100);
    }
    const clean = String(value || "").trim().replace(/[$,\s]/g, "");
    if (!clean) return null;
    if (!/^-?\d+(\.\d{0,2})?$/.test(clean)) return null;
    const neg = clean.startsWith("-");
    const raw = neg ? clean.slice(1) : clean;
    const parts = raw.split(".");
    const whole = Number(parts[0] || "0");
    const fraction = Number((parts[1] || "").padEnd(2, "0"));
    const cents = whole * 100 + fraction;
    return neg ? -cents : cents;
}

export function centsToDollars(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export function todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export function startOfWeek(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
}

export function endOfWeek(date) {
    const d = startOfWeek(date);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
}

export function startOfMonth(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
}

export function endOfMonth(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    d.setMonth(d.getMonth() + 1, 0);
    return d;
}

export function daysInMonth(date) {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function projection(totalSoFarCents, daysElapsed, totalDays) {
    if (daysElapsed <= 0) return totalSoFarCents;
    return Math.round((totalSoFarCents / daysElapsed) * totalDays);
}

export function getAllCategories(customCategories = []) {
    const all = [...customCategories, ...EXTRA_CATEGORIES];
    const seen = new Set();
    const out = [];
    for (const c of all) {
        if (!c?.key || seen.has(c.key)) continue;
        seen.add(c.key);
        out.push({
            key: c.key,
            label: c.label || c.key,
            emoji: c.emoji || FALLBACK_CATEGORY.emoji
        });
    }
    if (!seen.has(FALLBACK_CATEGORY.key)) out.push(FALLBACK_CATEGORY);
    return out;
}

function cycleToWeeklyFactor(cycle) {
    if (cycle === "weekly") return 1;
    if (cycle === "fortnightly") return 0.5;
    return 12 / 52;
}

function cycleToMonthlyFactor(cycle) {
    if (cycle === "monthly") return 1;
    if (cycle === "weekly") return 52 / 12;
    return 26 / 12;
}

export function convertCycleAmount(cents, cycle, period) {
    const amount = Number(cents || 0);
    if (period === "week") return Math.round(amount * cycleToWeeklyFactor(cycle));
    if (period === "month") return Math.round(amount * cycleToMonthlyFactor(cycle));
    return amount;
}

export function sumByRange(transactions, start, end) {
    const s = start.getTime();
    const e = end.getTime();
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
        const ts = new Date(`${t.date}T00:00:00`).getTime();
        if (ts < s || ts > e) continue;
        if (t.type === "income") income += Number(t.amountCents || 0);
        else expense += Number(t.amountCents || 0);
    }
    return { income, expense, net: income - expense };
}

export function expensesByCategory(transactions, start, end) {
    const s = start.getTime();
    const e = end.getTime();
    const map = new Map();
    for (const t of transactions) {
        if (t.type !== "expense") continue;
        const ts = new Date(`${t.date}T00:00:00`).getTime();
        if (ts < s || ts > e) continue;
        const cat = t.category || FALLBACK_CATEGORY.key;
        map.set(cat, (map.get(cat) || 0) + Number(t.amountCents || 0));
    }
    return map;
}

export function calculateReservationsForPeriod(budgets, bills, appState, period) {
    const payCycle = appState?.payCycle || "fortnightly";
    const categoryMap = new Map();
    let budgetTotal = 0;
    let billsReserved = 0;

    for (const b of budgets || []) {
        if (b.reserveFromUnallocated === false) continue;
        const cents = convertCycleAmount(Number(b.cycleBudgetCents || 0), payCycle, period);
        if (cents <= 0) continue;
        categoryMap.set(b.category, (categoryMap.get(b.category) || 0) + cents);
        budgetTotal += cents;
    }

    for (const bill of bills || []) {
        if (bill.active === false) continue;
        const cents = convertCycleAmount(Number(bill.amountCents || 0), bill.cycle || "monthly", period);
        if (cents <= 0) continue;
        const cat = bill.category || "bills";
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + cents);
        budgetTotal += cents;
        billsReserved += cents;
    }

    return { categoryMap, budgetTotal, billsReserved };
}

export function buildGuardrailAlerts(spentByCategory, reservedByCategory, categories) {
    const alerts = [];
    for (const [cat, spent] of spentByCategory.entries()) {
        const reserved = reservedByCategory.get(cat) || 0;
        if (reserved <= 0) continue;
        const pct = spent / reserved;
        const label = categories.find(c => c.key === cat)?.label || cat;
        if (pct >= 1) {
            alerts.push({ type: "bad", msg: `${label} reached 100% of reserved budget.` });
        } else if (pct >= 0.75) {
            alerts.push({ type: "warn", msg: `${label} reached 75% of reserved budget.` });
        }
    }
    return alerts;
}

export function calculateDashboardPeriod({
    transactions,
    budgets,
    bills,
    appState,
    nowDate,
    period
}) {
    const now = new Date(nowDate);
    const start = period === "week" ? startOfWeek(now) : startOfMonth(now);
    const end = period === "week" ? endOfWeek(now) : endOfMonth(now);
    const totals = sumByRange(transactions, start, end);
    const spentByCategory = expensesByCategory(transactions, start, end);
    const { categoryMap, budgetTotal, billsReserved } = calculateReservationsForPeriod(
        budgets,
        bills,
        appState,
        period
    );

    let overspendFromUnallocated = 0;
    for (const [cat, spent] of spentByCategory.entries()) {
        const reserved = categoryMap.get(cat) || 0;
        if (spent > reserved) overspendFromUnallocated += spent - reserved;
    }

    const spent = totals.expense;
    const income = totals.income;
    const remaining = budgetTotal - spent;
    const totalDays = period === "week" ? 7 : daysInMonth(now);
    const elapsedDays = period === "week"
        ? Math.max(1, Math.floor((new Date().setHours(0, 0, 0, 0) - start.getTime()) / (24 * 3600 * 1000)) + 1)
        : Math.max(1, now.getDate());
    const projected = projection(spent, elapsedDays, totalDays);
    const net = totals.net;
    const unallocated = income - budgetTotal - overspendFromUnallocated;
    const discretionaryAvailable = income - billsReserved - overspendFromUnallocated;

    return {
        rangeStart: start,
        rangeEnd: end,
        spent,
        budget: budgetTotal,
        remaining,
        projected,
        income,
        unallocated,
        net,
        billsReserved,
        discretionaryAvailable,
        spentByCategory,
        reservedByCategory: categoryMap,
        alerts: buildGuardrailAlerts(spentByCategory, categoryMap, getAllCategories(appState?.customCategories || []))
    };
}

export function ruleBasedCategoryHint(merchant) {
    const m = merchantKeyFrom(merchant);
    const rules = [
        { re: /(woolworths|coles|aldi|iga|costco)/, cat: "groceries" },
        { re: /(bp|ampol|caltex|7-eleven|7eleven|shell|opal)/, cat: "transport" },
        { re: /(uber eats|ubereats|menulog|doordash|kfc|mcdonald|hungry jacks|subway|domino)/, cat: "takeaway" },
        { re: /(starbucks|gloria jean|coffee|cafe)/, cat: "coffee" },
        { re: /(netflix|spotify|prime|adobe|apple\.com|google one|microsoft|xbox|playstation)/, cat: "subscriptions" },
        { re: /(electric|energy|gas|water|internet|telstra|optus|vodafone|nbn)/, cat: "utilities" },
        { re: /(chemist|pharmacy|doctor|dentist|physio|myhealth)/, cat: "health" },
        { re: /(rent|real estate|ray white|lj hooker)/, cat: "rent" }
    ];
    for (const rule of rules) {
        if (rule.re.test(m)) return rule.cat;
    }
    return FALLBACK_CATEGORY.key;
}

export function findSubscriptionCandidates(transactions, suppressedKeys = [], existingBills = []) {
    const suppressed = new Set([...(suppressedKeys || []), ...(existingBills || []).map(b => b.merchantKey).filter(Boolean)]);
    const byMerchant = new Map();
    for (const t of transactions) {
        if (t.type !== "expense") continue;
        if (!t.merchantKey || suppressed.has(t.merchantKey)) continue;
        if (!byMerchant.has(t.merchantKey)) byMerchant.set(t.merchantKey, []);
        byMerchant.get(t.merchantKey).push(t);
    }

    const out = [];
    for (const [merchantKey, txs] of byMerchant.entries()) {
        const months = new Map();
        for (const tx of txs) {
            const ym = tx.date.slice(0, 7);
            if (!months.has(ym)) months.set(ym, []);
            months.get(ym).push(Number(tx.amountCents || 0));
        }
        if (months.size < 2) continue;
        const medians = [...months.values()].map(median);
        const typicalCents = median(medians);
        const matches = medians.filter(x => Math.abs(x - typicalCents) <= Math.max(100, typicalCents * 0.1));
        if (matches.length >= 2) {
            out.push({ merchantKey, typicalCents, months: months.size });
        }
    }

    out.sort((a, b) => b.months - a.months || b.typicalCents - a.typicalCents);
    return out.slice(0, 12);
}

export function findSpendSpikesWithCauses(transactions, nowDate) {
    const now = new Date(nowDate);
    const thisWeekStart = startOfWeek(now);
    const thisWeekEnd = endOfWeek(now);
    const weekCats = expensesByCategory(transactions, thisWeekStart, thisWeekEnd);

    const previousTotals = new Map();
    for (let i = 1; i <= 4; i += 1) {
        const s = new Date(thisWeekStart);
        const e = new Date(thisWeekEnd);
        s.setDate(s.getDate() - 7 * i);
        e.setDate(e.getDate() - 7 * i);
        const prev = expensesByCategory(transactions, s, e);
        for (const [cat, cents] of prev.entries()) {
            previousTotals.set(cat, (previousTotals.get(cat) || 0) + cents);
        }
    }

    const spikes = [];
    for (const [cat, thisWeekCents] of weekCats.entries()) {
        const avgCents = Math.round((previousTotals.get(cat) || 0) / 4);
        if (avgCents <= 0) continue;
        if (thisWeekCents < Math.round(avgCents * 1.5)) continue;
        const causes = topMerchantsForCategory(transactions, cat, thisWeekStart, thisWeekEnd, 3);
        spikes.push({ category: cat, thisWeekCents, avgCents, causes });
    }
    spikes.sort((a, b) => (b.thisWeekCents - b.avgCents) - (a.thisWeekCents - a.avgCents));
    return spikes.slice(0, 10);
}

function topMerchantsForCategory(transactions, category, start, end, limit) {
    const s = start.getTime();
    const e = end.getTime();
    const byMerchant = new Map();
    for (const tx of transactions) {
        if (tx.type !== "expense" || tx.category !== category) continue;
        const ts = new Date(`${tx.date}T00:00:00`).getTime();
        if (ts < s || ts > e) continue;
        const name = tx.merchant || "Unknown";
        byMerchant.set(name, (byMerchant.get(name) || 0) + Number(tx.amountCents || 0));
    }
    return [...byMerchant.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([merchant, cents]) => ({ merchant, cents }));
}

export function eatingOutVsGroceriesInsight(transactions, nowDate) {
    const now = new Date(nowDate);
    const start = startOfMonth(now);
    const end = endOfMonth(now);
    const map = expensesByCategory(transactions, start, end);
    const eatingOut = (map.get("takeaway") || 0) + (map.get("social") || 0) + (map.get("food") || 0);
    const groceries = map.get("groceries") || 0;
    if (eatingOut > 0 || groceries > 0) {
        return {
            mode: "eatingOutVsGroceries",
            eatingOut,
            groceries
        };
    }
    const topTwo = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    return { mode: "topTwo", topTwo };
}

export function calculateSplitBalances(transactions) {
    let owedToMe = 0;
    let iOwe = 0;
    for (const tx of transactions) {
        if (tx.type !== "expense") continue;
        if (!tx.split?.enabled) continue;
        const amount = Number(tx.split.amountCents || 0);
        if (amount <= 0) continue;
        if (tx.split.type === "i_paid") owedToMe += amount;
        if (tx.split.type === "they_paid") iOwe += amount;
    }
    return { owedToMe, iOwe, net: owedToMe - iOwe };
}

export function suggestedStarterBudgets(incomePerCycleCents, payCycle, categories) {
    const weights = {
        food: 0.2,
        transport: 0.12,
        rent: 0.4,
        social: 0.12,
        subscriptions: 0.06
    };
    const fallbackWeight = 0.1;
    return (categories || []).map(cat => {
        const w = weights[cat.key] ?? fallbackWeight;
        const cycleBudgetCents = Math.round(Number(incomePerCycleCents || 0) * w);
        return {
            category: cat.key,
            cycleBudgetCents,
            reserveFromUnallocated: true,
            weeklyBudgetCents: convertCycleAmount(cycleBudgetCents, payCycle, "week"),
            monthlyBudgetCents: convertCycleAmount(cycleBudgetCents, payCycle, "month")
        };
    });
}

function median(values) {
    const arr = [...values].sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 === 1 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}
