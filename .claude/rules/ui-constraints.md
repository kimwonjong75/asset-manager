---
paths:
  - "components/**"
---

# UI Constraints

- Success messages: use `UpdateStatusIndicator` — **adding floating toasts is forbidden** (toasts were added and removed once; this is settled policy).
- Floating UI (inline `absolute` positioning is forbidden — all three are `z-menu` portals):
  - command menus → `ActionMenu`
  - form panels anchored to a button (filters, column settings) → `Popover`
  - search autocompletes → `Combobox` (no absolute result lists, no blur `setTimeout` hacks)
- Modals: use the common `Modal`; inline form errors: use `FieldError` with `aria-invalid`/`aria-describedby` (RULES.md §7).
- Do NOT add a wrapper with an `overflow` property between `<main>` and `<thead>` — it breaks sticky headers.
- Any feature added to the portfolio table MUST also be reflected in `PortfolioMobileCard`.
