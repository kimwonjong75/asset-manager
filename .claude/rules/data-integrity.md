---
paths:
  - "hooks/**"
  - "utils/**"
---

# Data Integrity

- Migrations: preserve existing values (use the `??` operator; overwriting with `=` is forbidden).
- Snapshot quantity back-calculation: if `unitPrice` is 0 or undefined, MUST skip.
- Load pipeline order: `repairCorruptedSnapshots` → `fillAllMissingDates` → `backfillWithRealPrices`.
- The snapshot repair pipeline order above is load-order-critical — do not reorder or insert steps between them.
