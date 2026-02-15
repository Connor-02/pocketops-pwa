// “AI worker” logic (AI-lite): categorise + alerts + projections + insights.

export const CATEGORIES = [
    { key: "groceries", label: "Groceries" },
    { key: "fuel", label: "Fuel" },
    { key: "takeaway", label: "Takeaway" },
    { key: "coffee", label: "Coffee" },
    { key: "bills", label: "Bills" },
    { key: "subscriptions", label: "Subscriptions" },
    { key: "shopping", label: "Shopping" },
    { key: "health", label: "Health" },
    { key: "rent", label: "Rent" },
    { key: "other", label: "Other" }
];

export function merchantKeyFrom(merchant) {
    return String(merchant || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function dollarsToCents(str) {
    const s = String(str || "").replace(/[$,\s]/g, "");
    const n = Number(s);
    if (Number.isNaN(n)) return null;
    return Math.round(n * 100);
}

export function centsToDollars(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

// Monday-start week
export function startOfWeek(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
}
export function endOfWeek(date) {
    const s = startOfWeek(date);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
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

export function todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export function ruleBasedCategoryHint(merchant) {
    const m = merchantKeyFrom(merchant);

    const rules = [
        { re: /(woolworths|coles|aldi|iga|costco)/, cat: "groceries" },
        { re: /(bp|ampol|caltex|7-eleven|7eleven|shell)/, cat: "fuel" },
        { re: /(uber eats|ubereats|menulog|doordash|kfc|mcdonald|hungry jacks|subway|domino)/, cat: "takeaway" },
        { re: /(starbucks|gloria jean|coffee|cafe)/, cat: "coffee" },
        { re: /(netflix|spotify|prime|adobe|apple\.com|google one|microsoft|xbox|playstation)/, cat: "subscriptions" },
        { re: /(electric|energy|gas|water|internet|telstra|optus|vodafone|nbn)/, cat: "bills" },
        { re: /(chemist|pharmacy|doctor|dentist|physio|myhealth)/, cat: "health" },
        { re: /(rent|real estate|ray white|lj hooker)/, cat: "rent" }
    ];

    for (const r of rules) if (r.re.test(m)) return r.cat;
    return "other";
}

export function sumByRange(transactions, start, end) {
    const s = start.getTime();
    const e = end.getTime();
    let expense = 0;
    let income = 0;

    for (const t of transactions) {
        const dt = new Date(t.date + "T00:00:00");
        const ts = dt.getTime();
        if (ts < s || ts > e) continue;
        if (t.type === "income") income += t.amountCents;
        else expense += t.amountCents;
    }
    return { expense, income, net: income - expense };
}

export function groupExpensesByCategory(transactions, start, end) {
    const map = new Map();
    const s = start.getTime();
    const e = end.getTime();

    for (const t of transactions) {
        if (t.type !== "expense") continue;
        const ts = new Date(t.date + "T00:00:00").getTime();
        if (ts < s || ts > e) continue;
        map.set(t.category, (map.get(t.category) || 0) + t.amountCents);
    }
    return map;
}

export function projection(totalSoFarCents, daysElapsed, totalDays) {
    if (daysElapsed <= 0) return totalSoFarCents;
    const perDay = totalSoFarCents / daysElapsed;
    return Math.round(perDay * totalDays);
}

export function buildAlerts({ weekSpent, weekBudget, weekProj, monthSpent, monthBudget, monthProj }) {
    const alerts = [];

    // Week
    if (weekBudget > 0) {
        if (weekSpent > weekBudget) alerts.push({ type: "bad", msg: `Over weekly budget by ${centsToDollars(weekSpent - weekBudget)} 😭` });
        else if (weekProj > weekBudget) alerts.push({ type: "warn", msg: `At current pace, you may exceed weekly budget (${centsToDollars(weekProj)} projected).` });
        else alerts.push({ type: "good", msg: `Weekly spending looks on track ✨` });
    } else {
        alerts.push({ type: "warn", msg: `Set a weekly budget to get better projections.` });
    }

    // Month
    if (monthBudget > 0) {
        if (monthSpent > monthBudget) alerts.push({ type: "bad", msg: `Over monthly budget by ${centsToDollars(monthSpent - monthBudget)} 😵` });
        else if (monthProj > monthBudget) alerts.push({ type: "warn", msg: `At current pace, you may exceed monthly budget (${centsToDollars(monthProj)} projected).` });
        else alerts.push({ type: "good", msg: `Monthly spending looks on track 🌸` });
    } else {
        alerts.push({ type: "warn", msg: `Set a monthly budget to get better projections.` });
    }

    return alerts;
}

// Subscription candidates: same merchant appears in >=2 different months with similar amounts
export function findSubscriptionCandidates(transactions) {
    const byMerchant = new Map();
    for (const t of transactions) {
        if (t.type !== "expense") continue;
        const key = t.merchantKey;
        if (!byMerchant.has(key)) byMerchant.set(key, []);
        byMerchant.get(key).push(t);
    }

    const candidates = [];
    for (const [m, txs] of byMerchant.entries()) {
        // group by YYYY-MM
        const months = new Map();
        for (const t of txs) {
            const ym = t.date.slice(0, 7);
            if (!months.has(ym)) months.set(ym, []);
            months.get(ym).push(t.amountCents);
        }
        if (months.size < 2) continue;

        // check if typical amount is consistent-ish
        const monthMeds = [...months.values()].map(arr => median(arr));
        const med = median(monthMeds);
        const close = monthMeds.filter(x => Math.abs(x - med) <= Math.max(100, med * 0.1)); // ±$1 or ±10%
        if (close.length >= 2) {
            candidates.push({ merchantKey: m, typicalCents: med, months: months.size });
        }
    }

    candidates.sort((a, b) => b.months - a.months);
    return candidates.slice(0, 10);
}

function median(arr) {
    const a = [...arr].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

// Spend spikes: this week vs avg of previous 4 weeks (category)
export function findSpendSpikes(transactions, nowDate) {
    const now = new Date(nowDate);
    const thisWeekStart = startOfWeek(now);
    const thisWeekEnd = endOfWeek(now);

    const thisWeekCats = groupExpensesByCategory(transactions, thisWeekStart, thisWeekEnd);

    // previous 4 weeks totals per category
    const prevTotals = new Map();
    for (let i = 1; i <= 4; i++) {
        const wStart = new Date(thisWeekStart); wStart.setDate(wStart.getDate() - 7 * i);
        const wEnd = new Date(thisWeekEnd); wEnd.setDate(wEnd.getDate() - 7 * i);
        const cats = groupExpensesByCategory(transactions, wStart, wEnd);
        for (const [cat, cents] of cats.entries()) {
            prevTotals.set(cat, (prevTotals.get(cat) || 0) + cents);
        }
    }

    const spikes = [];
    for (const [cat, cents] of thisWeekCats.entries()) {
        const avg = Math.round((prevTotals.get(cat) || 0) / 4);
        if (avg <= 0) continue;
        if (cents >= Math.round(avg * 1.5)) {
            spikes.push({ category: cat, thisWeekCents: cents, avgCents: avg });
        }
    }

    spikes.sort((a, b) => (b.thisWeekCents - b.avgCents) - (a.thisWeekCents - a.avgCents));
    return spikes.slice(0, 10);
}
