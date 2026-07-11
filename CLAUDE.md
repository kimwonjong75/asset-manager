# Asset Manager — Development Rules

## Must-read
- **Before modifying types/hooks/utils or adding any feature, read `RULES.md` first** (per-file responsibilities, dependency maps, checklists).

## Project overview
- Single-user personal quant asset-management system: stocks, crypto, and physical assets combined.
- Stack: React 19.2+, TypeScript, Vite, Tailwind CSS. State: Context API (`PortfolioContext`). Storage: Google Drive JSON sync (LZ-String compressed).

## Project map
| Path | Purpose |
|------|---------|
| `components/` | UI only. Subdirs: `layouts/` (tab views), `dashboard/`, `portfolio-table/`, `watchlist/`, `knowledge/`, `common/` |
| `hooks/` | Data/state/API orchestration |
| `utils/` | Pure functions |
| `services/` | External API calls |
| `types/`, `constants/`, `contexts/` (`PortfolioContext`), `config/` | Types, constants, context, config |
| `tests/` | Offline diagnostic scripts — NOT wired to CI; run manually via `npm run test:*` (parity/golden suites) and `npm run backtest` |
| `scripts/backtest/` | Backtest engine + data |
| `scripts/ingest/` | Knowledge-ingest pipeline (`validate_inbox.py`, `triage.workflow.js`, `triage_commit.py`) |
| `DB/` | LOCAL-ONLY knowledge-ingest data (gitignored): `inbox/` → `staging/` → `queue/knowledge-inbox.jsonl`; `STOP_INGEST.flag` is a kill switch; see `DB/README.md` |
| `docs/` | User-facing operation manuals (Korean) |
| Root | `App.tsx`, `index.tsx`, `vite.config.ts`, etc. |

- Naming collision: `components/portfolio-table/usePortfolioData.ts` (table-only enrichment/sort) ≠ `hooks/usePortfolioData.ts` (core data state + Drive sync).
- Detailed per-file responsibilities and dependency maps: RULES.md §3–§4 (the authoritative deep reference).

## Code structure
| Area | Responsibility | Forbidden |
|------|----------------|-----------|
| `components/` | UI rendering only | Business logic, API calls |
| `hooks/` | Data processing, API calls, state management | UI rendering |
| `utils/` | Pure functions, calculation logic | State mutation, side effects |
| `services/` | External API calls | State management |

## Type safety
- **`any` is strictly forbidden** — define all types in the `types/` directory.
- Component Props types are mandatory.
- Props drilling 3+ levels deep → use `PortfolioContext`.

## API rules
- External API calls only in dedicated hooks (`hooks/`).
- On failure: `try-catch` + fallback data required (partial success allowed).
- New Google Drive API fetch → must use `authenticatedFetch()` (raw fetch forbidden).
- Cloud Run server URL → use `CLOUD_RUN_BASE_URL` from `constants/api.ts` (no hardcoding).
- Logging → use `createLogger('module')` (direct `console.*` forbidden).

## Category system
- `asset.categoryId` (number) is PRIMARY — use `isBaseType(categoryId, 'CASH')`.
- `asset.category` (string) is **DEPRECATED** — forbidden in new code.
- Display name: `getCategoryName(categoryId, categories)`.

## Price & currency
- When comparing price against technical indicators (MA/RSI, etc.), use **`priceOriginal`** (guarantees currency match).
- Daily change shown in UI: use **`metrics.yesterdayChange`** (never display `changeRate` directly).

## Capability boundaries
- Backend Python source is NOT in this repo — deployed separately on Cloud Run (`asset-manager-887842923289.asia-northeast3.run.app`). Endpoints/response schemas: RULES.md §14. Backend changes mean the user redeploys; the frontend must auto-fallback when response fields are absent. Never conclude "cannot find backend code" — it is out-of-repo by design.
- Gemini API is BYOK: the user enters their own key in settings (localStorage, not synced). No key → AI analysis features are silently disabled; that is expected, not a bug.
- Knowledge ingest is manually triggered by the user ("인제스트 해줘") — no scheduler; the user's PC is not always on.
- No CI. Verification = run the relevant `npm run test:<suite>` + `npm run build` (tsc) manually.
- Google Drive access uses the `drive.file` scope via `authenticatedFetch()`; JWT lives in localStorage key `google_drive_jwt`.

## Communication & workflow
- Respond to the user in **Korean** (documents/code comments may be English; this file is English).
- Git: the user commits/pushes personally via GitHub Desktop. Claude NEVER runs `git commit`/`git push`. Deliverable = code + passing tests + a report containing: list of changed files, verification results, and a suggested commit message.
- Proceed WITHOUT asking: display/toggle features, pure utils + tests, read-only dashboards, RULES.md updates, verification runs.
- ALWAYS confirm BEFORE: real-trade/money-action logic changes, Google Drive save-policy changes, data deletion, changing the default tab, external-API policy changes.

## Lessons learned
- Engine changes require golden-value parity tests (`tests/*Parity.ts`), not just "it runs" ← a satellite ATR sizing bug once produced 0 trades in 8 of 9 tickers for an entire backtest with no error.
- Parity tests must pin EXPLICIT golden absolute values ← comparing path-A-vs-path-B becomes a self-referential tautology after the common function is extracted (RULES.md §13).
- Distribution-day 50-day trailing averages must EXCLUDE day i ← a look-ahead bias was found and fixed.
- Historical FX values need sanity-bound checks (USD>3000, JPY>50, CNY>400 → replace with current app rate) ← the FX API occasionally returns corrupted values.
- Success feedback goes through `UpdateStatusIndicator` only ← floating toasts were added and removed once.
- "Invisible writes" are forbidden: background effects must not auto-save user data without a visible user action or an explicit opt-in setting ← this shaped the `useActionQueue`/`useTurtleActionReview` design.
- Full pitfall catalog: RULES.md §8.

## Documentation maintenance
- **Update RULES.md immediately after modifying the corresponding code file** (do not defer to end of session — context overflow can cause it to be dropped).
- After updating RULES.md, verify against this self-check:
  - Are function signature/parameter changes of the modified file reflected?
  - Are newly added helpers/utils described in that file's row?
  - Are new caveats (abnormal-value handling, fallback logic, etc.) stated?
  - Are deleted/changed functions removed from the previous description?
- Propose removing RULES.md descriptions of deleted features/files as soon as they are found.

## Scoped rules & execution model
- All work follows the Advisor/Worker execution model — see `.claude/rules/execution-model.md`.
- Path-scoped rules (auto-applied by path):
  - `.claude/rules/ui-constraints.md` — UI constraints, scoped to `components/**`.
  - `.claude/rules/data-integrity.md` — data-integrity rules, scoped to `hooks/**` and `utils/**`.
