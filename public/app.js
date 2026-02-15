import {
    addTransaction, getAllTransactions, deleteTransaction,
    getBudgets, saveBudgets,
    getMerchantCategory, setMerchantCategory
} from "./db.js";

import {
    CATEGORIES, merchantKeyFrom, ruleBasedCategoryHint,
    dollarsToCents, centsToDollars,
    startOfWeek, endOfWeek, startOfMonth, endOfMonth, daysInMonth,
    sumByRange, groupExpensesByCategory, projection, buildAlerts,
    todayISO, findSubscriptionCandidates, findSpendSpikes
} from "./worker.js";

// Register service worker (offline)
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => { });
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const tabBtns = $$(".tab");
const panes = $$(".tabpane");

function setTab(name) {
    tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    panes.forEach(p => p.classList.toggle("hidden", p.id !== `tab-${name}`));
}

tabBtns.forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

const txForm = $("#txForm");
const txType = $("#txType");
const txAmount = $("#txAmount");
const txMerchant = $("#txMerchant");
const txCategory = $("#txCategory");
const txDate = $("#txDate");
const txNotes = $("#txNotes");

const weekRange = $("#weekRange");
const monthRange = $("#monthRange");

const weekSpentEl = $("#weekSpent");
const weekBudgetEl = $("#weekBudget");
const weekRemainEl = $("#weekRemain");
const weekProjEl = $("#weekProj");
const weekIncomeEl = $("#weekIncome");
const weekUnallocEl = $("#weekUnalloc");
const weekNetEl = $("#weekNet");
const weekBar = $("#weekBar");

const monthSpentEl = $("#monthSpent");
const monthBudgetEl = $("#monthBudget");
const monthRemainEl = $("#monthRemain");
const monthProjEl = $("#monthProj");
const monthIncomeEl = $("#monthIncome");
const monthUnallocEl = $("#monthUnalloc");
const monthNetEl = $("#monthNet");
const monthBar = $("#monthBar");

const alertsEl = $("#alerts");
const topCatsEl = $("#topCats");

const budgetList = $("#budgetList");
const saveBudgetsBtn = $("#saveBudgetsBtn");

const txListEl = $("#txList");
const searchTx = $("#searchTx");
const rangeTx = $("#rangeTx");

const subsEl = $("#subs");
const spikesEl = $("#spikes");
const exportBtn = $("#exportBtn");
const seedBtn = $("#seedBtn");

txDate.value = todayISO();

// Populate categories
for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = c.label;
    txCategory.appendChild(opt);
}

txMerchant.addEventListener("input", async () => {
    const key = merchantKeyFrom(txMerchant.value);
    if (!key) return;

    const remembered = await getMerchantCategory(key);
    if (remembered) {
        txCategory.value = remembered;
    } else {
        txCategory.value = ruleBasedCategoryHint(txMerchant.value);
    }
});

// ----- Budget UI -----
async function renderBudgets() {
    const budgetMap = await getBudgets();

    budgetList.innerHTML = "";
    for (const c of CATEGORIES) {
        const existing = budgetMap.get(c.key) || { category: c.key, weeklyBudgetCents: 0, monthlyBudgetCents: 0 };

        const row = document.createElement("div");
        row.className = "budget-row";
        row.innerHTML = `
      <div class="cat"><span class="dot"></span>${c.label}</div>
      <input class="input" inputmode="decimal" data-cat="${c.key}" data-period="week" value="${(existing.weeklyBudgetCents / 100).toFixed(2)}" />
      <input class="input" inputmode="decimal" data-cat="${c.key}" data-period="month" value="${(existing.monthlyBudgetCents / 100).toFixed(2)}" />
    `;
        budgetList.appendChild(row);
    }
}

saveBudgetsBtn.addEventListener("click", async () => {
    const inputs = budgetList.querySelectorAll("input[data-cat]");
    const map = new Map(); // cat -> {weekly, monthly}

    inputs.forEach(inp => {
        const cat = inp.dataset.cat;
        const period = inp.dataset.period;
        const cents = dollarsToCents(inp.value) ?? 0;
        if (!map.has(cat)) map.set(cat, { category: cat, weeklyBudgetCents: 0, monthlyBudgetCents: 0 });
        if (period === "week") map.get(cat).weeklyBudgetCents = cents;
        else map.get(cat).monthlyBudgetCents = cents;
    });

    await saveBudgets([...map.values()]);
    await refreshAll();
    alert("Budgets saved 💾");
});

// ----- Add transaction -----
txForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const cents = dollarsToCents(txAmount.value);
    if (cents === null || cents < 0) {
        alert("Enter a valid amount");
        return;
    }

    const merchant = txMerchant.value.trim();
    const category = txCategory.value;
    const date = txDate.value;

    const mKey = merchantKeyFrom(merchant);

    const tx = {
        id: crypto.randomUUID(),
        type: txType.value,
        amountCents: cents,
        merchant,
        merchantKey: mKey,
        category,
        date,
        notes: txNotes.value.trim()
    };

    await addTransaction(tx);

    // Learn merchant -> category for future
    if (merchant && category) await setMerchantCategory(mKey, category);

    txAmount.value = "";
    txMerchant.value = "";
    txNotes.value = "";

    await refreshAll();
    setTab("dash");
});

// ----- Dashboard + Lists -----
function meterWidth(spent, budget) {
    if (budget <= 0) return 0;
    return Math.min(100, Math.round((spent / budget) * 100));
}

function fmtRange(start, end) {
    const s = start.toLocaleDateString();
    const e = end.toLocaleDateString();
    return `${s} → ${e}`;
}

function topN(map, n = 4) {
    const arr = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return arr;
}

function catLabel(key) {
    return CATEGORIES.find(c => c.key === key)?.label || key;
}

function makeAlert(type, msg) {
    const div = document.createElement("div");
    div.className = `alert ${type}`;
    div.textContent = msg;
    return div;
}

async function renderDashboard(transactions) {
    const now = new Date();

    const ws = startOfWeek(now);
    const we = endOfWeek(now);
    const ms = startOfMonth(now);
    const me = endOfMonth(now);

    weekRange.textContent = fmtRange(ws, we);
    monthRange.textContent = fmtRange(ms, me);

    const budgets = await getBudgets();
    let weekBudget = 0, monthBudget = 0;
    for (const c of CATEGORIES) {
        const b = budgets.get(c.key);
        if (!b) continue;
        weekBudget += b.weeklyBudgetCents || 0;
        monthBudget += b.monthlyBudgetCents || 0;
    }

    const weekSum = sumByRange(transactions, ws, we);
    const monthSum = sumByRange(transactions, ms, me);

    const weekIncome = weekSum.income;
    const weekSpent = weekSum.expense;
    const weekUnalloc = weekIncome - weekBudget;
    const weekNet = weekIncome - weekSpent;
    const weekSafeSpendRemaining = weekIncome - weekSpent;

    const monthIncome = monthSum.income;
    const monthSpent = monthSum.expense;
    const monthUnalloc = monthIncome - monthBudget;
    const monthNet = monthIncome - monthSpent;
    const monthSafeSpendRemaining = monthIncome - monthSpent;

    const daysElapsedWeek = Math.max(1, Math.floor((new Date().setHours(0, 0, 0, 0) - ws.getTime()) / (24 * 3600 * 1000)) + 1);
    const daysElapsedMonth = Math.max(1, new Date().getDate());

    const weekProj = projection(weekSpent, daysElapsedWeek, 7);
    const monthProj = projection(monthSpent, daysElapsedMonth, daysInMonth(now));

    weekSpentEl.textContent = centsToDollars(weekSpent);
    weekBudgetEl.textContent = centsToDollars(weekBudget);
    weekRemainEl.textContent = centsToDollars(weekBudget - weekSpent);
    weekProjEl.textContent = centsToDollars(weekProj);
    weekIncomeEl.textContent = centsToDollars(weekIncome);
    weekUnallocEl.textContent = centsToDollars(weekUnalloc);
    weekNetEl.textContent = centsToDollars(weekNet);
    weekBar.style.width = `${meterWidth(weekSpent, weekBudget)}%`;

    monthSpentEl.textContent = centsToDollars(monthSpent);
    monthBudgetEl.textContent = centsToDollars(monthBudget);
    monthRemainEl.textContent = centsToDollars(monthBudget - monthSpent);
    monthProjEl.textContent = centsToDollars(monthProj);
    monthIncomeEl.textContent = centsToDollars(monthIncome);
    monthUnallocEl.textContent = centsToDollars(monthUnalloc);
    monthNetEl.textContent = centsToDollars(monthNet);
    monthBar.style.width = `${meterWidth(monthSpent, monthBudget)}%`;

    // Alerts
    alertsEl.innerHTML = "";
    const alerts = buildAlerts({ weekSpent, weekBudget, weekProj, monthSpent, monthBudget, monthProj });
    if (weekIncome > 0 && weekBudget > weekIncome) {
        alerts.push({ type: "warn", msg: `Budgets exceed income by ${centsToDollars(weekBudget - weekIncome)} this week.` });
    }
    if (weekSafeSpendRemaining < 0) {
        alerts.push({ type: "bad", msg: `You've spent ${centsToDollars(Math.abs(weekSafeSpendRemaining))} more than you earned this week.` });
    }
    if (monthIncome > 0 && monthBudget > monthIncome) {
        alerts.push({ type: "warn", msg: `Budgets exceed income by ${centsToDollars(monthBudget - monthIncome)} this month.` });
    }
    if (monthSafeSpendRemaining < 0) {
        alerts.push({ type: "bad", msg: `You've spent ${centsToDollars(Math.abs(monthSafeSpendRemaining))} more than you earned this month.` });
    }
    if (alerts.length === 0) alertsEl.appendChild(makeAlert("warn", "No alerts yet."));
    for (const a of alerts) alertsEl.appendChild(makeAlert(a.type, a.msg));

    // Top cats
    const weekCats = groupExpensesByCategory(transactions, ws, we);
    const monthCats = groupExpensesByCategory(transactions, ms, me);

    topCatsEl.innerHTML = "";
    const weekTop = topN(weekCats, 4);
    const monthTop = topN(monthCats, 4);

    const mk = (title, rows) => {
        const box = document.createElement("div");
        box.className = "card soft";
        box.innerHTML = `<h3>${title}</h3>`;
        if (rows.length === 0) {
            const p = document.createElement("div");
            p.className = "muted";
            p.textContent = "No spend yet.";
            box.appendChild(p);
            return box;
        }
        for (const [cat, cents] of rows) {
            const it = document.createElement("div");
            it.className = "item";
            it.innerHTML = `<b>${catLabel(cat)}</b><div class="muted">${centsToDollars(cents)}</div>`;
            box.appendChild(it);
        }
        return box;
    };

    topCatsEl.appendChild(mk("This week", weekTop));
    topCatsEl.appendChild(mk("This month", monthTop));

    // Insights
    const subs = findSubscriptionCandidates(transactions);
    subsEl.innerHTML = subs.length ? "" : `<div class="muted">No candidates yet.</div>`;
    for (const s of subs) {
        const it = document.createElement("div");
        it.className = "item";
        it.innerHTML = `<b>${s.merchantKey}</b><div class="muted">~${centsToDollars(s.typicalCents)} • ${s.months} months</div>`;
        subsEl.appendChild(it);
    }

    const spikes = findSpendSpikes(transactions, now);
    spikesEl.innerHTML = spikes.length ? "" : `<div class="muted">No spikes detected.</div>`;
    for (const sp of spikes) {
        const it = document.createElement("div");
        it.className = "item";
        it.innerHTML = `<b>${catLabel(sp.category)}</b>
      <div class="muted">This week ${centsToDollars(sp.thisWeekCents)} vs avg ${centsToDollars(sp.avgCents)}</div>`;
        spikesEl.appendChild(it);
    }
}

function txInRange(tx, mode) {
    if (mode === "all") return true;
    const now = new Date();
    const s = mode === "week" ? startOfWeek(now) : startOfMonth(now);
    const e = mode === "week" ? endOfWeek(now) : endOfMonth(now);
    const ts = new Date(tx.date + "T00:00:00").getTime();
    return ts >= s.getTime() && ts <= e.getTime();
}

function renderTxList(transactions) {
    const q = searchTx.value.trim().toLowerCase();
    const mode = rangeTx.value;

    let items = transactions.filter(t => txInRange(t, mode));
    if (q) {
        items = items.filter(t =>
            t.merchantKey.includes(q) ||
            t.category.toLowerCase().includes(q)
        );
    }

    items.sort((a, b) => b.date.localeCompare(a.date));

    txListEl.innerHTML = "";
    if (!items.length) {
        txListEl.innerHTML = `<div class="muted">No transactions.</div>`;
        return;
    }

    for (const t of items) {
        const div = document.createElement("div");
        div.className = "tx";

        const amtClass = t.type === "income" ? "income" : "expense";
        const sign = t.type === "income" ? "+" : "-";

        div.innerHTML = `
      <div class="left">
        <div class="m">${t.merchant}</div>
        <div class="s">${catLabel(t.category)} • ${t.date}${t.notes ? " • " + t.notes : ""}</div>
      </div>
      <div class="right">
        <div class="amt ${amtClass}">${sign}${centsToDollars(t.amountCents)}</div>
        <button class="btn ghost" data-del="${t.id}" style="margin-top:8px;">Delete</button>
      </div>
    `;

        div.querySelector(`[data-del="${t.id}"]`).addEventListener("click", async () => {
            if (!confirm("Delete this transaction?")) return;
            await deleteTransaction(t.id);
            await refreshAll();
        });

        txListEl.appendChild(div);
    }
}

searchTx.addEventListener("input", refreshAll);
rangeTx.addEventListener("change", refreshAll);

exportBtn.addEventListener("click", async () => {
    const txs = await getAllTransactions();
    const header = ["date", "type", "amount", "merchant", "category", "notes"];
    const rows = txs
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(t => [
            t.date,
            t.type,
            (t.amountCents / 100).toFixed(2),
            escapeCsv(t.merchant),
            t.category,
            escapeCsv(t.notes || "")
        ].join(","));

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pocketops_${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

function escapeCsv(s) {
    const v = String(s || "");
    if (/[,"\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
    return v;
}

// Seed example data
seedBtn.addEventListener("click", async () => {
    const base = todayISO();
    const examples = [
        { type: "expense", amount: "124.50", merchant: "Woolworths", category: "groceries", date: base, notes: "" },
        { type: "expense", amount: "62.00", merchant: "BP", category: "fuel", date: base, notes: "" },
        { type: "expense", amount: "18.90", merchant: "UberEats", category: "takeaway", date: base, notes: "" },
        { type: "expense", amount: "14.50", merchant: "Gloria Jean's", category: "coffee", date: base, notes: "" },
        { type: "expense", amount: "16.99", merchant: "Spotify", category: "subscriptions", date: base.slice(0, 7) + "-01", notes: "" }
    ];

    for (const e of examples) {
        const cents = dollarsToCents(e.amount);
        await addTransaction({
            id: crypto.randomUUID(),
            type: e.type,
            amountCents: cents,
            merchant: e.merchant,
            merchantKey: merchantKeyFrom(e.merchant),
            category: e.category,
            date: e.date,
            notes: e.notes
        });
        await setMerchantCategory(merchantKeyFrom(e.merchant), e.category);
    }

    // default budgets
    await saveBudgets(CATEGORIES.map(c => ({
        category: c.key,
        weeklyBudgetCents: c.key === "groceries" ? 20000 : 0,   // $200
        monthlyBudgetCents: c.key === "groceries" ? 80000 : 0  // $800
    })));

    await refreshAll();
    alert("Seeded cute example data 🐰✨");
});

async function refreshAll() {
    const txs = await getAllTransactions();
    await renderBudgets();
    await renderDashboard(txs);
    renderTxList(txs);
}

await refreshAll();

// ---- Install button support ----
let deferredPrompt = null;
const installBtn = $("#installBtn");

window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
});

installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
});
