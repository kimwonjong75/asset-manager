---
paths:
  - "components/**"
---

# UI Constraints

- Success messages: use `UpdateStatusIndicator` — **adding floating toasts is forbidden** (toasts were added and removed once; this is settled policy).
- Dropdown menus: use the `ActionMenu` component (inline absolute positioning is forbidden).
- Do NOT add a wrapper with an `overflow` property between `<main>` and `<thead>` — it breaks sticky headers.
- Any feature added to the portfolio table MUST also be reflected in `PortfolioMobileCard`.
