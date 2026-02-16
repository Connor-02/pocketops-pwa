import {
    APP_SCHEMA_VERSION,
    STARTER_CATEGORIES,
    DEFAULT_APP_STATE,
    merchantKeyFrom,
    ruleBasedCategoryHint,
    dollarsToCents,
    centsToDollars,
    todayISO,
    getAllCategories,
    calculateDashboardPeriod,
    findSubscriptionCandidates,
    findSpendSpikesWithCauses,
    eatingOutVsGroceriesInsight,
    calculateSplitBalances,
    suggestedStarterBudgets,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth
} from "./calculations.js";

import {
    addTransaction, updateTransaction, deleteTransaction,
    getAllTransactions, getBudgets, saveBudgets,
    getBills, saveBill, deleteBill,
    getMerchantCategory, setMerchantCategory,
    getAppState, saveAppState, exportSnapshot, restoreSnapshot
} from "./db.js";

import { makeExportPayload, normalizeImportedPayload, validateImportPayload } from "./import-export.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});

let appState = { ...DEFAULT_APP_STATE };
let transactions = [];
let budgets = [];
let bills = [];
let categories = getAllCategories(
  DEFAULT_APP_STATE.customCategories,
  DEFAULT_APP_STATE.categoryOverrides,
  DEFAULT_APP_STATE.deletedCategoryKeys
);
let editingTxId = null;
let onboardingStep = 1;
let onboardingNames = STARTER_CATEGORIES.map(c => ({ ...c }));
let onboardingBudgetDraft = {};
let undoAction = null;
let toastTimer = null;
let deferredPrompt = null;
let categoryModalMode = "add";
let categoryModalKey = "";
const DASHBOARD_VIEW_KEY = "pocketops.dashboardView";
let dashboardView = localStorage.getItem(DASHBOARD_VIEW_KEY) === "month" ? "month" : "week";
let dashboardDetailsOpen = false;
let dashboardPeriodCache = { week: null, month: null };

const tabBtns = $$(".tab"), panes = $$(".tabpane");
const installBtn = $("#installBtn"), resetOnboardingBtn = $("#resetOnboardingBtn"), offlineBadge = $("#offlineBadge"), quickAddBtn = $("#quickAddBtn");
const txForm = $("#txForm"), txSubmitBtn = $("#txSubmitBtn"), txType = $("#txType"), txAmount = $("#txAmount"), txMerchant = $("#txMerchant"), txCategorySearch = $("#txCategorySearch"), txCategory = $("#txCategory"), recentCats = $("#recentCats"), txDate = $("#txDate"), txNotes = $("#txNotes"), txSplitToggle = $("#txSplitToggle"), splitFields = $("#splitFields"), txSplitType = $("#txSplitType"), txSplitAmount = $("#txSplitAmount"), txSplitPercent = $("#txSplitPercent");
const dashPeriodWeeklyBtn = $("#dashPeriodWeekly"), dashPeriodMonthlyBtn = $("#dashPeriodMonthly"), periodTitleEl = $("#periodTitle"), periodRangeEl = $("#periodRange"), periodRemainEl = $("#periodRemain"), periodSpentEl = $("#periodSpent"), periodBudgetEl = $("#periodBudget"), periodUnallocEl = $("#periodUnalloc"), periodIncomeEl = $("#periodIncome"), periodNetEl = $("#periodNet"), periodProjEl = $("#periodProj"), periodBarEl = $("#periodBar"), periodDetailsToggleBtn = $("#periodDetailsToggle"), periodDetailsPanel = $("#periodDetailsPanel"), availableBillsEl = $("#availableBills"), availableDiscretionaryEl = $("#availableDiscretionary"), alertsCardEl = $("#alertsCard"), alertsEl = $("#alerts"), insightAlertsEl = $("#insightAlerts");
const budgetList = $("#budgetList"), saveBudgetsBtn = $("#saveBudgetsBtn"), billForm = $("#billForm"), billName = $("#billName"), billAmount = $("#billAmount"), billCycle = $("#billCycle"), billCategory = $("#billCategory"), billList = $("#billList");
const addCategoryBtn = $("#addCategoryBtn");
const txListEl = $("#txList"), searchTx = $("#searchTx"), rangeTx = $("#rangeTx"), splitsCard = $("#splitsCard"), coachCard = $("#coachCard");
const subsEl = $("#subs"), spikesEl = $("#spikes"), exportBtn = $("#exportBtn"), exportJsonBtn = $("#exportJsonBtn"), importJsonInput = $("#importJsonInput"), importStatus = $("#importStatus");
const pinGate = $("#pinGate"), pinUnlockForm = $("#pinUnlockForm"), pinUnlockInput = $("#pinUnlockInput"), pinUnlockError = $("#pinUnlockError"), pinForm = $("#pinForm"), pinInput = $("#pinInput"), pinDisableBtn = $("#pinDisableBtn");
const onboardingEl = $("#onboarding"), onboardStepLabel = $("#onboardStepLabel"), obSteps = $$(".onboard-step"), obBack = $("#obBack"), obNext = $("#obNext"), obDemo = $("#obDemo"), obIncome = $("#obIncome"), obPayday = $("#obPayday"), obCategories = $("#obCategories"), obSuggestedBudgets = $("#obSuggestedBudgets");
const categoryModal = $("#categoryModal"), categoryModalTitle = $("#categoryModalTitle"), categoryModalForm = $("#categoryModalForm"), categoryModalName = $("#categoryModalName"), categoryModalEmoji = $("#categoryModalEmoji"), categoryModalCancel = $("#categoryModalCancel");
const toast = $("#toast"), toastMsg = $("#toastMsg"), toastUndo = $("#toastUndo");

const setTab = (name) => {
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  panes.forEach(p => p.classList.toggle("hidden", p.id !== `tab-${name}`));
  if (name === "add") setTimeout(() => txAmount.focus(), 20);
};
tabBtns.forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; installBtn.hidden = false; });
installBtn.addEventListener("click", async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; installBtn.hidden = true; });
quickAddBtn.addEventListener("click", () => setTab("add"));
const setDashboardView = (view) => {
  dashboardView = view === "month" ? "month" : "week";
  localStorage.setItem(DASHBOARD_VIEW_KEY, dashboardView);
  dashPeriodWeeklyBtn?.classList.toggle("active", dashboardView === "week");
  dashPeriodMonthlyBtn?.classList.toggle("active", dashboardView === "month");
  if (dashboardPeriodCache[dashboardView]) {
    renderPeriodView(dashboardView);
    renderAvailableCard();
    const selectedAlerts = getDashboardAlerts(dashboardView);
    renderAlerts(selectedAlerts);
  }
};
dashPeriodWeeklyBtn?.addEventListener("click", () => setDashboardView("week"));
dashPeriodMonthlyBtn?.addEventListener("click", () => setDashboardView("month"));
periodDetailsToggleBtn?.addEventListener("click", () => {
  dashboardDetailsOpen = !dashboardDetailsOpen;
  periodDetailsPanel?.classList.toggle("open", dashboardDetailsOpen);
  periodDetailsToggleBtn.textContent = dashboardDetailsOpen ? "Hide details ▲" : "Show details ▼";
  periodDetailsToggleBtn.setAttribute("aria-expanded", String(dashboardDetailsOpen));
});
const updateOfflineBadge = () => { offlineBadge.textContent = navigator.onLine ? "Offline-first: data stored locally (online)" : "Offline-first: data stored locally (offline)"; };
window.addEventListener("online", updateOfflineBadge); window.addEventListener("offline", updateOfflineBadge);

const meterWidth = (s, b) => b <= 0 ? 0 : Math.min(100, Math.round((s / b) * 100));
const fmtRange = (s, e) => `${s.toLocaleDateString()} -> ${e.toLocaleDateString()}`;
const catMeta = (key) => categories.find(c => c.key === key) || { key, label: key, emoji: "?" };
const makeAlert = (type, msg) => { const d = document.createElement("div"); d.className = `alert ${type}`; d.textContent = msg; return d; };
const hashText = async (t) => { const data = new TextEncoder().encode(t); const h = await crypto.subtle.digest("SHA-256", data); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); };
const escapeCsv = (v) => { const s = String(v || ""); return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
const downloadBlob = (content, type, filename) => { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); };
const shiftMonth = (iso, dlt) => { const d = new Date(`${iso}T00:00:00`); d.setMonth(d.getMonth() + dlt); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(Math.min(d.getDate(), 28)).padStart(2, "0")}`; };
const slugify = (name) => String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const hasCategoryKey = (key) => categories.some(c => c.key === key);
const fallbackCategoryKey = () => categories[0]?.key || "other";

function showToast(msg, undoFn) {
  undoAction = undoFn || null;
  toastMsg.textContent = msg;
  toast.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.add("hidden"); undoAction = null; }, 5000);
}
toastUndo.addEventListener("click", async () => { if (!undoAction) return; const fn = undoAction; undoAction = null; toast.classList.add("hidden"); await fn(); await loadStateAndRender(); });

function renderCategoryPickers() {
  txCategory.innerHTML = "";
  billCategory.innerHTML = "";
  categories.forEach(c => {
    const text = `${c.emoji} ${c.label}`;
    const o1 = document.createElement("option"); o1.value = c.key; o1.textContent = text; txCategory.appendChild(o1);
    const o2 = document.createElement("option"); o2.value = c.key; o2.textContent = text; billCategory.appendChild(o2);
  });
  billCategory.value = "bills";
  recentCats.innerHTML = "";
  (appState.recentCategories || []).forEach(key => {
    const c = catMeta(key); const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = `${c.emoji} ${c.label}`;
    b.addEventListener("click", () => txCategory.value = key); recentCats.appendChild(b);
  });
}

async function deleteCategoryByKey(key) {
  const category = categories.find(c => c.key === key);
  if (!category) return;
  if (!confirm(`Delete category "${category.label}"? Existing transactions/bills will move to another category.`)) return;

  const custom = appState.customCategories || [];
  const nextCustom = custom.filter(x => x.key !== key);
  const nextRecent = (appState.recentCategories || []).filter(x => x !== key);
  const nextDeleted = [...new Set([...(appState.deletedCategoryKeys || []), key])];
  const nextOverrides = { ...(appState.categoryOverrides || {}) };
  delete nextOverrides[key];
  appState = await saveAppState({
    customCategories: nextCustom,
    recentCategories: nextRecent,
    deletedCategoryKeys: nextDeleted,
    categoryOverrides: nextOverrides
  });

  const nextBudgets = (budgets || []).filter(b => b.category !== key);
  await saveBudgets(nextBudgets);

  const nextCategories = getAllCategories(
    appState.customCategories || [],
    appState.categoryOverrides || {},
    appState.deletedCategoryKeys || []
  );
  const remapCategory = nextCategories[0]?.key || "other";

  const txToMove = transactions.filter(t => t.category === key);
  await Promise.all(txToMove.map(t => updateTransaction({ ...t, category: remapCategory })));

  const billsToMove = bills.filter(b => b.category === key);
  await Promise.all(billsToMove.map(b => saveBill({ ...b, category: remapCategory })));
}

function openCategoryModal(mode, key = "") {
  categoryModalMode = mode;
  categoryModalKey = key;
  if (mode === "edit") {
    const current = categories.find(c => c.key === key);
    if (!current) return;
    categoryModalTitle.textContent = "Edit category";
    categoryModalName.value = current.label || "";
    categoryModalEmoji.value = current.emoji || "✨";
  } else {
    categoryModalTitle.textContent = "Add category";
    categoryModalName.value = "";
    categoryModalEmoji.value = "✨";
  }
  categoryModal.classList.remove("hidden");
  setTimeout(() => categoryModalName.focus(), 20);
}

function closeCategoryModal() {
  categoryModal.classList.add("hidden");
}

txCategorySearch.addEventListener("input", () => {
  const q = txCategorySearch.value.trim().toLowerCase();
  txCategory.innerHTML = "";
  categories.forEach(c => {
    if (q && !`${c.key} ${c.label}`.toLowerCase().includes(q)) return;
    const o = document.createElement("option"); o.value = c.key; o.textContent = `${c.emoji} ${c.label}`; txCategory.appendChild(o);
  });
});

addCategoryBtn?.addEventListener("click", () => openCategoryModal("add"));

categoryModalCancel?.addEventListener("click", closeCategoryModal);
categoryModal?.addEventListener("click", (e) => {
  if (e.target === categoryModal) closeCategoryModal();
});
categoryModalForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = (categoryModalName.value || "").trim();
  if (!name) return alert("Category name cannot be empty.");
  const emoji = (categoryModalEmoji.value || "").trim() || "✨";

  if (categoryModalMode === "edit") {
    const nextOverrides = { ...(appState.categoryOverrides || {}) };
    nextOverrides[categoryModalKey] = { label: name, emoji };
    appState = await saveAppState({ categoryOverrides: nextOverrides });
    closeCategoryModal();
    showToast(`Category "${name}" updated.`, null);
    await loadStateAndRender();
    txCategory.value = categoryModalKey;
    return;
  }

  const baseKey = slugify(name);
  if (!baseKey) return alert("Please use letters or numbers in category name.");
  let key = baseKey;
  let i = 2;
  while (hasCategoryKey(key)) {
    key = `${baseKey}_${i}`;
    i += 1;
  }
  const nextCustom = [...(appState.customCategories || []), { key, label: name, emoji }];
  const nextDeleted = (appState.deletedCategoryKeys || []).filter(x => x !== key);
  appState = await saveAppState({ customCategories: nextCustom, deletedCategoryKeys: nextDeleted });
  closeCategoryModal();
  showToast(`Category "${name}" added.`, null);
  await loadStateAndRender();
  txCategory.value = key;
});

txDate.value = todayISO();
obPayday.value = todayISO();
txMerchant.addEventListener("input", async () => { const key = merchantKeyFrom(txMerchant.value); if (!key) return; txCategory.value = await getMerchantCategory(key) || ruleBasedCategoryHint(txMerchant.value); });
txSplitToggle.addEventListener("change", () => splitFields.classList.toggle("hidden", !txSplitToggle.checked));

const serializeSplit = (baseCents) => {
  if (!txSplitToggle.checked) return { enabled: false };
  let cents = dollarsToCents(txSplitAmount.value);
  const pct = Number(txSplitPercent.value || 0);
  if ((!Number.isInteger(cents) || cents <= 0) && pct > 0) cents = Math.round(baseCents * (pct / 100));
  if (!Number.isInteger(cents) || cents <= 0) return { enabled: false };
  return { enabled: true, type: txSplitType.value, amountCents: Math.min(baseCents, cents) };
};

async function rememberCategory(cat) {
  const next = [cat, ...(appState.recentCategories || []).filter(x => x !== cat)].slice(0, 5);
  appState = await saveAppState({ recentCategories: next });
}

function clearTxForm() {
  editingTxId = null;
  txSubmitBtn.textContent = "Add Transaction";
  txAmount.value = ""; txMerchant.value = ""; txNotes.value = "";
  txSplitToggle.checked = false; splitFields.classList.add("hidden"); txSplitAmount.value = ""; txSplitPercent.value = "";
}

txForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amountCents = dollarsToCents(txAmount.value);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return alert("Enter a valid amount.");
  const merchant = txMerchant.value.trim();
  if (!merchant) return alert("Merchant is required.");
  const tx = {
    id: editingTxId || crypto.randomUUID(),
    type: txType.value,
    amountCents,
    merchant,
    merchantKey: merchantKeyFrom(merchant),
    category: txCategory.value || "other",
    date: txDate.value,
    notes: txNotes.value.trim(),
    split: serializeSplit(amountCents)
  };
  if (editingTxId) {
    const prev = transactions.find(t => t.id === editingTxId);
    await updateTransaction(tx);
    showToast("Transaction updated.", async () => prev && updateTransaction(prev));
  } else {
    await addTransaction(tx);
    showToast("Transaction added.", async () => deleteTransaction(tx.id));
  }
  await setMerchantCategory(tx.merchantKey, tx.category);
  await rememberCategory(tx.category);
  clearTxForm();
  await loadStateAndRender();
  setTab("dash");
});

async function renderBudgets() {
  budgetList.innerHTML = "";
  const map = new Map((budgets || []).map(b => [b.category, b]));
  categories.forEach(c => {
    const row = map.get(c.key) || { cycleBudgetCents: 0, reserveFromUnallocated: true };
    const div = document.createElement("div");
    div.className = "budget-row";
    div.innerHTML = `
      <div class="cat-block">
        <div class="cat">${c.emoji} ${c.label}</div>
        <div class="cat-actions">
          <button class="btn ghost cat-mini-btn" type="button" data-bcat-edit="${c.key}">Edit</button>
          <button class="btn ghost cat-mini-btn" type="button" data-bcat-del="${c.key}">Delete</button>
        </div>
      </div>
      <input class="input" inputmode="decimal" data-cat="${c.key}" data-kind="amount" value="${(Number(row.cycleBudgetCents || 0) / 100).toFixed(2)}" />
      <label class="chip"><input type="checkbox" data-cat="${c.key}" data-kind="reserve" ${row.reserveFromUnallocated !== false ? "checked" : ""}> Reserve</label>
    `;
    div.querySelector(`[data-bcat-edit="${c.key}"]`)?.addEventListener("click", () => openCategoryModal("edit", c.key));
    div.querySelector(`[data-bcat-del="${c.key}"]`)?.addEventListener("click", async () => {
      await deleteCategoryByKey(c.key);
      await loadStateAndRender();
      txCategory.value = fallbackCategoryKey();
    });
    budgetList.appendChild(div);
  });
}

saveBudgetsBtn.addEventListener("click", async () => {
  const out = categories.map(c => {
    const a = budgetList.querySelector(`input[data-cat="${c.key}"][data-kind="amount"]`);
    const r = budgetList.querySelector(`input[data-cat="${c.key}"][data-kind="reserve"]`);
    return { category: c.key, cycleBudgetCents: dollarsToCents(a?.value || "0") || 0, reserveFromUnallocated: !!r?.checked };
  });
  await saveBudgets(out);
  showToast("Budgets saved.", null);
  await loadStateAndRender();
});

billForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cents = dollarsToCents(billAmount.value);
  if (!Number.isInteger(cents) || cents <= 0) return alert("Enter a valid bill amount.");
  await saveBill({ id: crypto.randomUUID(), name: billName.value.trim(), amountCents: cents, cycle: billCycle.value, category: billCategory.value || "bills", active: true });
  billName.value = ""; billAmount.value = "";
  await loadStateAndRender();
});

function renderBills() {
  billList.innerHTML = "";
  if (!bills.length) return billList.innerHTML = `<div class="muted">No fixed bills yet.</div>`;
  bills.forEach(b => {
    const div = document.createElement("div"); div.className = "item";
    div.innerHTML = `<b>${b.name}</b><div class="muted">${centsToDollars(b.amountCents)} � ${b.cycle} � ${catMeta(b.category).label}</div><button class="btn ghost" data-del-bill="${b.id}">Delete</button>`;
    div.querySelector(`[data-del-bill="${b.id}"]`).addEventListener("click", async () => { await deleteBill(b.id); await loadStateAndRender(); });
    billList.appendChild(div);
  });
}

function txInRange(tx, mode) {
  if (mode === "all") return true;
  const now = new Date();
  const s = mode === "week" ? startOfWeek(now) : startOfMonth(now);
  const e = mode === "week" ? endOfWeek(now) : endOfMonth(now);
  const ts = new Date(`${tx.date}T00:00:00`).getTime();
  return ts >= s.getTime() && ts <= e.getTime();
}

function renderTransactions() {
  const q = searchTx.value.trim().toLowerCase();
  const mode = rangeTx.value;
  let items = [...transactions].filter(t => txInRange(t, mode));
  if (q) items = items.filter(t => t.merchantKey.includes(q) || t.category.toLowerCase().includes(q) || (t.notes || "").toLowerCase().includes(q));
  items.sort((a, b) => b.date.localeCompare(a.date));
  txListEl.innerHTML = "";
  if (!items.length) return txListEl.innerHTML = `<div class="muted">No transactions.</div>`;
  items.forEach(t => {
    const row = document.createElement("div"); row.className = "tx";
    const sign = t.type === "income" ? "+" : "-";
    const cls = t.type === "income" ? "income" : "expense";
    const splitText = t.split?.enabled ? ` � split: ${t.split.type === "i_paid" ? "owed to me" : "i owe"} ${centsToDollars(t.split.amountCents)}` : "";
    row.innerHTML = `<div class="left"><div class="m">${t.merchant}</div><div class="s">${catMeta(t.category).label} � ${t.date}${t.notes ? ` � ${t.notes}` : ""}${splitText}</div></div><div class="right"><div class="amt ${cls}">${sign}${centsToDollars(t.amountCents)}</div><div class="row right"><button class="btn ghost" data-edit="${t.id}">Edit</button><button class="btn ghost" data-del="${t.id}">Delete</button></div></div>`;
    row.querySelector(`[data-edit="${t.id}"]`).addEventListener("click", () => {
      editingTxId = t.id; txSubmitBtn.textContent = "Save Transaction";
      txType.value = t.type; txAmount.value = (t.amountCents / 100).toFixed(2); txMerchant.value = t.merchant; txCategory.value = t.category; txDate.value = t.date; txNotes.value = t.notes || "";
      txSplitToggle.checked = !!t.split?.enabled; splitFields.classList.toggle("hidden", !txSplitToggle.checked); txSplitType.value = t.split?.type || "i_paid"; txSplitAmount.value = t.split?.enabled ? (Number(t.split.amountCents) / 100).toFixed(2) : ""; txSplitPercent.value = "";
      setTab("add"); txAmount.focus();
    });
    row.querySelector(`[data-del="${t.id}"]`).addEventListener("click", async () => { await deleteTransaction(t.id); showToast("Transaction deleted.", async () => addTransaction(t)); await loadStateAndRender(); });
    txListEl.appendChild(row);
  });
}
searchTx.addEventListener("input", renderTransactions);
rangeTx.addEventListener("change", renderTransactions);

function getDashboardAlerts(type) {
  const period = dashboardPeriodCache[type];
  if (!period) return [];
  const alerts = [...(period.alerts || [])];
  if (period.unallocated < 0) {
    alerts.push({ type: "bad", msg: `${type === "week" ? "Weekly" : "Monthly"} unallocated is negative after category overspend.` });
  }
  return alerts;
}

function renderPeriodView(type) {
  const period = dashboardPeriodCache[type];
  if (!period) return;
  periodTitleEl.textContent = type === "week" ? "This Week" : "This Month";
  periodRangeEl.textContent = fmtRange(period.rangeStart, period.rangeEnd);
  periodRemainEl.textContent = centsToDollars(period.remaining);
  periodSpentEl.textContent = centsToDollars(period.spent);
  periodBudgetEl.textContent = centsToDollars(period.budget);
  periodUnallocEl.textContent = centsToDollars(period.unallocated);
  periodIncomeEl.textContent = centsToDollars(period.income);
  periodNetEl.textContent = centsToDollars(period.net);
  periodProjEl.textContent = centsToDollars(period.projected);
  periodBarEl.style.width = `${meterWidth(period.spent, period.budget)}%`;
  periodDetailsPanel?.classList.toggle("open", dashboardDetailsOpen);
  periodDetailsToggleBtn.textContent = dashboardDetailsOpen ? "Hide details ▲" : "Show details ▼";
  periodDetailsToggleBtn.setAttribute("aria-expanded", String(dashboardDetailsOpen));
}

function renderAvailableCard() {
  const period = dashboardPeriodCache[dashboardView];
  if (!period) return;
  availableBillsEl.textContent = centsToDollars(period.billsReserved);
  availableDiscretionaryEl.textContent = centsToDollars(period.discretionaryAvailable);
}

function renderAlerts(alerts) {
  if (!alerts?.length) {
    alertsCardEl.classList.add("hidden");
    alertsEl.innerHTML = "";
    return;
  }
  alertsCardEl.classList.remove("hidden");
  alertsEl.innerHTML = "";
  alerts.forEach(a => alertsEl.appendChild(makeAlert(a.type, a.msg)));
}

function renderDashboard() {
  const now = new Date();
  dashboardPeriodCache.week = calculateDashboardPeriod({ transactions, budgets, bills, appState, nowDate: now, period: "week" });
  dashboardPeriodCache.month = calculateDashboardPeriod({ transactions, budgets, bills, appState, nowDate: now, period: "month" });

  dashPeriodWeeklyBtn?.classList.toggle("active", dashboardView === "week");
  dashPeriodMonthlyBtn?.classList.toggle("active", dashboardView === "month");
  renderPeriodView(dashboardView);
  renderAvailableCard();
  renderAlerts(getDashboardAlerts(dashboardView));

  const insightAlerts = [...getDashboardAlerts("week"), ...getDashboardAlerts("month")];
  insightAlertsEl.innerHTML = "";
  insightAlerts.forEach(a => insightAlertsEl.appendChild(makeAlert(a.type, a.msg)));
}

function renderInsights() {
  const cand = findSubscriptionCandidates(transactions, appState.suppressedSubscriptionKeys, bills);
  subsEl.innerHTML = "";
  if (!cand.length) subsEl.innerHTML = `<div class="muted">No subscription candidates yet.</div>`;
  cand.forEach(c => {
    const div = document.createElement("div"); div.className = "item";
    div.innerHTML = `<b>${c.merchantKey}</b><div class="muted">~${centsToDollars(c.typicalCents)} � ${c.months} months</div><button class="btn" data-sub="${c.merchantKey}">Mark as subscription</button>`;
    div.querySelector(`[data-sub="${c.merchantKey}"]`).addEventListener("click", async () => {
      await saveBill({ id: crypto.randomUUID(), name: c.merchantKey, merchantKey: c.merchantKey, amountCents: c.typicalCents, cycle: "monthly", category: "subscriptions", active: true });
      appState = await saveAppState({ suppressedSubscriptionKeys: [...new Set([...(appState.suppressedSubscriptionKeys || []), c.merchantKey])] });
      await loadStateAndRender();
    });
    subsEl.appendChild(div);
  });

  const spikes = findSpendSpikesWithCauses(transactions, new Date());
  spikesEl.innerHTML = "";
  if (!spikes.length) spikesEl.innerHTML = `<div class="muted">No spikes detected.</div>`;
  spikes.forEach(s => {
    const causes = s.causes.map(c => `${c.merchant} ${centsToDollars(c.cents)}`).join(", ");
    const div = document.createElement("div"); div.className = "item";
    div.innerHTML = `<b>${catMeta(s.category).label}</b><div class="muted">This week ${centsToDollars(s.thisWeekCents)} vs avg ${centsToDollars(s.avgCents)}</div><div class="muted">Top causes: ${causes || "n/a"}</div>`;
    spikesEl.appendChild(div);
  });

  const split = calculateSplitBalances(transactions);
  splitsCard.innerHTML = `<div class="item"><b>Owed to me</b><div class="muted">${centsToDollars(split.owedToMe)}</div></div><div class="item"><b>I owe</b><div class="muted">${centsToDollars(split.iOwe)}</div></div>`;

  const coach = eatingOutVsGroceriesInsight(transactions, new Date());
  if (coach.mode === "eatingOutVsGroceries") {
    coachCard.innerHTML = `<div class="item"><b>Eating out vs groceries</b></div><div class="item">Eating out: ${centsToDollars(coach.eatingOut)}</div><div class="item">Groceries: ${centsToDollars(coach.groceries)}</div>`;
  } else {
    coachCard.innerHTML = `<div class="item"><b>Top two spending categories</b></div>${coach.topTwo.length ? coach.topTwo.map(([cat, cents]) => `<div class="item">${catMeta(cat).label}: ${centsToDollars(cents)}</div>`).join("") : `<div class="muted">No spending data yet.</div>`}`;
  }
}

exportBtn.addEventListener("click", () => {
  const header = ["date", "type", "amount", "merchant", "category", "notes"];
  const rows = [...transactions].sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type, (Number(t.amountCents) / 100).toFixed(2), escapeCsv(t.merchant), t.category, escapeCsv(t.notes || "")].join(","));
  downloadBlob([header.join(","), ...rows].join("\n"), "text/csv", `pocketops_${todayISO()}.csv`);
});

exportJsonBtn.addEventListener("click", async () => {
  downloadBlob(JSON.stringify(makeExportPayload(await exportSnapshot()), null, 2), "application/json", `pocketops_${todayISO()}.json`);
});

importJsonInput.addEventListener("change", async () => {
  const file = importJsonInput.files?.[0]; if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const valid = validateImportPayload(payload);
    if (!valid.ok) return importStatus.textContent = `Import failed: ${valid.errors[0]}`;
    await restoreSnapshot(normalizeImportedPayload(payload));
    importStatus.textContent = "Import complete.";
    await loadStateAndRender();
  } catch { importStatus.textContent = "Import failed: invalid JSON file."; }
  importJsonInput.value = "";
});

pinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = pinInput.value.trim(); if (!/^\d{4}$/.test(pin)) return alert("PIN must be exactly 4 digits.");
  appState = await saveAppState({ pinEnabled: true, pinHash: await hashText(pin) });
  pinInput.value = ""; showToast("PIN enabled on this device.", null);
});
pinDisableBtn.addEventListener("click", async () => { appState = await saveAppState({ pinEnabled: false, pinHash: "" }); showToast("PIN disabled.", null); });
pinUnlockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await hashText(pinUnlockInput.value.trim()) !== appState.pinHash) return pinUnlockError.classList.remove("hidden");
  pinUnlockError.classList.add("hidden"); pinUnlockInput.value = ""; pinGate.classList.add("hidden");
});
function renderOnboardingCategoryInputs() {
  obCategories.innerHTML = "";
  onboardingNames.forEach((cat, idx) => {
    const div = document.createElement("div"); div.className = "item";
    div.innerHTML = `<label>${cat.emoji || "?"} starter ${idx + 1}</label><input class="input" data-ob-name="${cat.key}" value="${cat.label}" />`;
    obCategories.appendChild(div);
  });
  obCategories.querySelectorAll("input[data-ob-name]").forEach(inp => inp.addEventListener("input", () => {
    const key = inp.dataset.obName; onboardingNames = onboardingNames.map(c => c.key === key ? { ...c, label: inp.value.trim() || c.label } : c);
  }));
}

function updateOnboardingStep() {
  onboardStepLabel.textContent = `Step ${onboardingStep} of 4`;
  obSteps.forEach(s => s.classList.toggle("hidden", Number(s.dataset.step) !== onboardingStep));
  obBack.disabled = onboardingStep === 1; obNext.textContent = onboardingStep === 4 ? "Finish setup" : "Next";
  const payCycle = document.querySelector('input[name="payCycle"]:checked')?.value || "fortnightly";
  const incomeCents = dollarsToCents(obIncome.value || "0") || 0;
  if (onboardingStep === 4) {
    const suggestions = suggestedStarterBudgets(incomeCents, payCycle, onboardingNames);
    obSuggestedBudgets.innerHTML = suggestions.map(s => {
      const label = (onboardingNames.find(x => x.key === s.category)?.label) || s.category;
      const placeholder = (s.cycleBudgetCents / 100).toFixed(2);
      const value = onboardingBudgetDraft[s.category] ?? "";
      return `<div class="item">
        <b>${label}</b>
        <div class="muted">Suggested: ${centsToDollars(s.cycleBudgetCents)} per ${payCycle}</div>
        <input class="input" data-ob-budget="${s.category}" inputmode="decimal" placeholder="${placeholder}" value="${value}" />
      </div>`;
    }).join("");
    obSuggestedBudgets.querySelectorAll("input[data-ob-budget]").forEach(inp => {
      inp.addEventListener("input", () => {
        onboardingBudgetDraft[inp.dataset.obBudget] = inp.value.trim();
      });
    });
  }
}

function showOnboarding() {
  onboardingStep = 1; onboardingNames = STARTER_CATEGORIES.map(c => ({ ...c }));
  onboardingBudgetDraft = {};
  renderOnboardingCategoryInputs(); updateOnboardingStep(); onboardingEl.classList.remove("hidden");
}

async function seedDemoData() {
  const base = todayISO();
  const examples = [
    { type: "expense", amount: "92.30", merchant: "Woolworths", category: "groceries", date: base, notes: "" },
    { type: "expense", amount: "34.10", merchant: "Opal", category: "transport", date: base, notes: "" },
    { type: "expense", amount: "58.00", merchant: "Sharehouse dinner", category: "social", date: base, notes: "with mates", split: { enabled: true, type: "i_paid", amountCents: 2900 } },
    { type: "expense", amount: "16.99", merchant: "Spotify", category: "subscriptions", date: shiftMonth(base, -1), notes: "" },
    { type: "expense", amount: "16.99", merchant: "Spotify", category: "subscriptions", date: shiftMonth(base, -2), notes: "" }
  ];
  for (const e of examples) {
    const cents = dollarsToCents(e.amount);
    await addTransaction({ id: crypto.randomUUID(), type: e.type, amountCents: cents, merchant: e.merchant, merchantKey: merchantKeyFrom(e.merchant), category: e.category, date: e.date, notes: e.notes, split: e.split || { enabled: false } });
    await setMerchantCategory(merchantKeyFrom(e.merchant), e.category);
  }
  await saveBill({ id: crypto.randomUUID(), name: "Rent", amountCents: 40000, cycle: appState.payCycle || "fortnightly", category: "rent", active: true });
}

async function completeOnboarding(useDemo) {
  const payCycle = document.querySelector('input[name="payCycle"]:checked')?.value || "fortnightly";
  const income = dollarsToCents(obIncome.value || "0") || 0;
  const paydayISO = obPayday.value || todayISO();
  // Read current visible inputs directly so the final typed value is always captured.
  obSuggestedBudgets.querySelectorAll("input[data-ob-budget]").forEach(inp => {
    onboardingBudgetDraft[inp.dataset.obBudget] = inp.value.trim();
  });
  appState = await saveAppState({
    onboardingCompleted: true,
    payCycle,
    paydayISO,
    lastPaydayISO: paydayISO,
    incomePerCycleCents: income,
    useScheduledIncome: true,
    customCategories: onboardingNames
  });
  const suggested = suggestedStarterBudgets(income, payCycle, onboardingNames);
  const onboardingBudgets = suggested.map(row => {
    const typed = onboardingBudgetDraft[row.category];
    const typedCents = typed ? (dollarsToCents(typed) || 0) : 0;
    return { ...row, cycleBudgetCents: typedCents };
  });
  await saveBudgets(onboardingBudgets);
  if (useDemo) await seedDemoData();
  onboardingEl.classList.add("hidden");
  await loadStateAndRender();
}

obBack.addEventListener("click", () => { onboardingStep = Math.max(1, onboardingStep - 1); updateOnboardingStep(); });
obNext.addEventListener("click", async () => {
  if (onboardingStep === 2) {
    const i = dollarsToCents(obIncome.value || "0");
    if (!Number.isInteger(i) || i < 0) return alert("Please enter a valid income value.");
    if (!obPayday.value) return alert("Please select when you last got paid.");
  }
  if (onboardingStep < 4) { onboardingStep += 1; return updateOnboardingStep(); }
  await completeOnboarding(false);
});
obDemo.addEventListener("click", async () => completeOnboarding(true));

resetOnboardingBtn.addEventListener("click", async () => {
  if (!confirm("Reset setup and clear local transactions/budgets/bills?")) return;
  const keepPin = { pinEnabled: appState.pinEnabled, pinHash: appState.pinHash };
  await restoreSnapshot({ appState: { ...DEFAULT_APP_STATE, ...keepPin, onboardingCompleted: false, schemaVersion: APP_SCHEMA_VERSION }, transactions: [], budgets: [], bills: [], merchantMap: [] });
  await loadStateAndRender();
  showOnboarding();
});

async function loadStateAndRender() {
  appState = await getAppState();
  categories = getAllCategories(
    appState.customCategories,
    appState.categoryOverrides,
    appState.deletedCategoryKeys
  );
  [transactions, budgets, bills] = await Promise.all([getAllTransactions(), getBudgets(), getBills()]);
  renderCategoryPickers();
  await renderBudgets();
  renderBills();
  renderDashboard();
  renderTransactions();
  renderInsights();
}

async function init() {
  updateOfflineBadge();
  await loadStateAndRender();
  if (appState.pinEnabled && appState.pinHash) pinGate.classList.remove("hidden");
  if (!appState.onboardingCompleted) showOnboarding();
}

init();
