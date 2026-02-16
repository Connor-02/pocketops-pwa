import { APP_SCHEMA_VERSION, DEFAULT_APP_STATE } from "./calculations.js";

const DB_NAME = "pocketops";
const DB_VERSION = 2;

function reqToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;

            if (!db.objectStoreNames.contains("transactions")) {
                const txStore = db.createObjectStore("transactions", { keyPath: "id" });
                txStore.createIndex("by_date", "date", { unique: false });
                txStore.createIndex("by_merchant", "merchantKey", { unique: false });
                txStore.createIndex("by_category", "category", { unique: false });
            }

            if (!db.objectStoreNames.contains("budgets")) {
                db.createObjectStore("budgets", { keyPath: "category" });
            }

            if (!db.objectStoreNames.contains("merchantMap")) {
                db.createObjectStore("merchantMap", { keyPath: "merchantKey" });
            }

            if (!db.objectStoreNames.contains("settings")) {
                db.createObjectStore("settings", { keyPath: "key" });
            }

            if (!db.objectStoreNames.contains("bills")) {
                const billStore = db.createObjectStore("bills", { keyPath: "id" });
                billStore.createIndex("by_cycle", "cycle", { unique: false });
            }
        };

        req.onsuccess = async () => {
            const db = req.result;
            await ensureAppState(db);
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    });
}

async function ensureAppState(db) {
    const tx = db.transaction("settings", "readwrite");
    const settings = tx.objectStore("settings");
    const existing = await reqToPromise(settings.get("appState"));
    if (!existing) {
        settings.put({ ...DEFAULT_APP_STATE });
    } else if (existing.schemaVersion !== APP_SCHEMA_VERSION) {
        settings.put({
            ...DEFAULT_APP_STATE,
            ...existing,
            schemaVersion: APP_SCHEMA_VERSION
        });
    }
    await txDone(tx);
}

async function withStore(storeName, mode, fn) {
    const db = await openDb();
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const out = fn(store);
    await txDone(tx);
    return out;
}

export async function addTransaction(tx) {
    return withStore("transactions", "readwrite", store => store.put(tx));
}

export async function updateTransaction(tx) {
    return withStore("transactions", "readwrite", store => store.put(tx));
}

export async function getAllTransactions() {
    const db = await openDb();
    const tx = db.transaction("transactions", "readonly");
    const items = await reqToPromise(tx.objectStore("transactions").getAll());
    await txDone(tx);
    return items || [];
}

export async function deleteTransaction(id) {
    return withStore("transactions", "readwrite", store => store.delete(id));
}

export async function getBudgets() {
    const db = await openDb();
    const tx = db.transaction("budgets", "readonly");
    const items = await reqToPromise(tx.objectStore("budgets").getAll());
    await txDone(tx);
    return (items || []).map(b => ({
        reserveFromUnallocated: true,
        cycleBudgetCents: 0,
        ...b,
        cycleBudgetCents: Number(b.cycleBudgetCents ?? b.weeklyBudgetCents ?? 0)
    }));
}

export async function saveBudgets(budgetRows) {
    const db = await openDb();
    const tx = db.transaction("budgets", "readwrite");
    const store = tx.objectStore("budgets");
    store.clear();
    for (const row of budgetRows) store.put(row);
    await txDone(tx);
    return true;
}

export async function getBills() {
    const db = await openDb();
    const tx = db.transaction("bills", "readonly");
    const items = await reqToPromise(tx.objectStore("bills").getAll());
    await txDone(tx);
    return items || [];
}

export async function saveBill(bill) {
    return withStore("bills", "readwrite", store => store.put(bill));
}

export async function deleteBill(id) {
    return withStore("bills", "readwrite", store => store.delete(id));
}

export async function getMerchantCategory(merchantKey) {
    const db = await openDb();
    const tx = db.transaction("merchantMap", "readonly");
    const item = await reqToPromise(tx.objectStore("merchantMap").get(merchantKey));
    await txDone(tx);
    return item?.category || null;
}

export async function setMerchantCategory(merchantKey, category) {
    return withStore("merchantMap", "readwrite", store => store.put({ merchantKey, category }));
}

export async function getMerchantMapEntries() {
    const db = await openDb();
    const tx = db.transaction("merchantMap", "readonly");
    const items = await reqToPromise(tx.objectStore("merchantMap").getAll());
    await txDone(tx);
    return items || [];
}

export async function getAppState() {
    const db = await openDb();
    const tx = db.transaction("settings", "readonly");
    const item = await reqToPromise(tx.objectStore("settings").get("appState"));
    await txDone(tx);
    return {
        ...DEFAULT_APP_STATE,
        ...(item || {}),
        schemaVersion: APP_SCHEMA_VERSION
    };
}

export async function saveAppState(partial) {
    const current = await getAppState();
    const next = {
        ...current,
        ...(partial || {}),
        key: "appState",
        schemaVersion: APP_SCHEMA_VERSION
    };
    await withStore("settings", "readwrite", store => store.put(next));
    return next;
}

export async function exportSnapshot() {
    const [appState, transactions, budgets, bills, merchantMap] = await Promise.all([
        getAppState(),
        getAllTransactions(),
        getBudgets(),
        getBills(),
        getMerchantMapEntries()
    ]);
    return { appState, transactions, budgets, bills, merchantMap };
}

export async function restoreSnapshot(snapshot) {
    const db = await openDb();
    const tx = db.transaction(["settings", "transactions", "budgets", "bills", "merchantMap"], "readwrite");
    tx.objectStore("settings").clear();
    tx.objectStore("transactions").clear();
    tx.objectStore("budgets").clear();
    tx.objectStore("bills").clear();
    tx.objectStore("merchantMap").clear();

    tx.objectStore("settings").put({ ...DEFAULT_APP_STATE, ...(snapshot.appState || {}), key: "appState" });
    for (const item of snapshot.transactions || []) tx.objectStore("transactions").put(item);
    for (const item of snapshot.budgets || []) tx.objectStore("budgets").put(item);
    for (const item of snapshot.bills || []) tx.objectStore("bills").put(item);
    for (const item of snapshot.merchantMap || []) tx.objectStore("merchantMap").put(item);

    await txDone(tx);
    return true;
}
