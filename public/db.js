const DB_NAME = "pocketops";
const DB_VERSION = 1;

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;

            // transactions
            if (!db.objectStoreNames.contains("transactions")) {
                const tx = db.createObjectStore("transactions", { keyPath: "id" });
                tx.createIndex("by_date", "date", { unique: false });
                tx.createIndex("by_merchant", "merchantKey", { unique: false });
                tx.createIndex("by_category", "category", { unique: false });
            }

            // budgets per category
            if (!db.objectStoreNames.contains("budgets")) {
                db.createObjectStore("budgets", { keyPath: "category" });
            }

            // merchant -> category memory
            if (!db.objectStoreNames.contains("merchantMap")) {
                db.createObjectStore("merchantMap", { keyPath: "merchantKey" });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const out = fn(store);

        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
    });
}

// ----- Transactions -----
export async function addTransaction(tx) {
    return withStore("transactions", "readwrite", (store) => store.put(tx));
}

export async function getAllTransactions() {
    return new Promise(async (resolve, reject) => {
        const db = await openDb();
        const tx = db.transaction("transactions", "readonly");
        const store = tx.objectStore("transactions");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteTransaction(id) {
    return withStore("transactions", "readwrite", (store) => store.delete(id));
}

// ----- Budgets -----
export async function getBudgets() {
    const items = await new Promise(async (resolve, reject) => {
        const db = await openDb();
        const tx = db.transaction("budgets", "readonly");
        const store = tx.objectStore("budgets");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });

    const map = new Map(items.map(b => [b.category, b]));
    return map;
}

export async function saveBudgets(budgetRows) {
    // budgetRows: [{category, weeklyBudgetCents, monthlyBudgetCents}]
    const db = await openDb();
    const tx = db.transaction("budgets", "readwrite");
    const store = tx.objectStore("budgets");

    for (const b of budgetRows) store.put(b);

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

// ----- Merchant memory -----
export async function getMerchantCategory(merchantKey) {
    const db = await openDb();
    const tx = db.transaction("merchantMap", "readonly");
    const store = tx.objectStore("merchantMap");
    const req = store.get(merchantKey);

    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result?.category ?? null);
        req.onerror = () => reject(req.error);
    });
}

export async function setMerchantCategory(merchantKey, category) {
    return withStore("merchantMap", "readwrite", (store) => store.put({ merchantKey, category }));
}
