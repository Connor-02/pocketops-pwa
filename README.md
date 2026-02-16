# PocketOps PWA

Offline-first budgeting PWA for uni/post-grad users. Data is stored locally on-device by default.

## Features
- Dashboard, Add Budgets, Transactions, Insights, Alerts, CSV Export (preserved sections).
- First-run onboarding (pay cycle, income, starter categories, suggested starter budgets, demo seed).
- Zero-based budgeting with `Unallocated` focus and reserve toggles per category.
- Fixed recurring bills reserved from unallocated.
- Subscription candidates can be marked as recurring bills.
- Split transactions (`I paid` / `They paid`) with split summary totals.
- Mobile quick-add button, category search/recent chips, category emoji picker.
- Undo toast after add/edit/delete transaction.
- Offline indicator, JSON export, JSON import/restore with validation.
- Optional local 4-digit PIN lock stored as a SHA-256 hash.
- Spend guardrails (75% / 100%), spike explanations, and coaching insight card.
- Versioned local schema and modular calculation engine using integer cents.
- Simplified dashboard: weekly/monthly segmented view, Remaining as hero metric, collapsible advanced details, compact conditional alerts, and combined "Available to Spend" card.

## Local Run
1. Use any static file server at repo root.
2. Example:
```bash
npx serve public
```
3. Open the served URL in a browser.

## Build
No bundler step is required for this version. Deploy the `public/` folder as static assets.

## Deploy
- Static host options: GitHub Pages, Netlify, Cloudflare Pages, Vercel static output.
- Ensure HTTPS so service worker + PWA install behave correctly.
- Keep `public/service-worker.js` and `public/manifest.json` at site root paths.

## Offline Storage
- Transactions, budgets, recurring bills, merchant mappings, and app settings are stored in IndexedDB (`pocketops`, schema v2).
- Service worker caches shell assets for offline app loading.
- Data stays local unless user explicitly exports JSON/CSV.

## Test
```bash
npm test
```

## Changelog
### 2026-02-16
- Added onboarding flow with reset setup and demo seed option.
- Added zero-based reserve logic around `Unallocated`.
- Added fixed recurring bills and dashboard reserve/discretionary metrics.
- Added subscription candidate confirm-to-recurring workflow.
- Added split transaction support and split summary card.
- Added UX polish: amount-first form, quick-add FAB, undo toast, emoji/recent/search category picker.
- Added offline indicator and JSON import/export with validation.
- Added optional local PIN lock using hashed PIN.
- Added student-focused insights (guardrails, spike causes, coaching card).
- Added schema versioning and modular calculations.
- Added basic unit tests for calculations + import validation.
- Redesigned dashboard for clarity: single-period toggle, hero Remaining, advanced metrics collapse, hidden-empty alerts, and modular render functions.
