# Test Coverage Analysis — GCFinance

**Date**: 2026-02-20
**Branch**: `claude/analyze-test-coverage-EvVIH`

---

## Executive Summary

**Current test coverage: 0%**

No test files, no test runner, no test configuration exist anywhere in the
project. The entire application is a single 2,103-line `app.js` loaded as a
global script with no ES module exports, making tests non-trivial but entirely
achievable with a small refactor.

This document identifies what to test, in what order, and why — using a
risk-adjusted ROI approach rather than chasing a line-coverage number.

---

## Current State

The application is structured as follows:

| File | Lines | Role |
|------|-------|------|
| `app.js` | 2,103 | All business logic, rendering, event wiring |
| `index.html` | 598 | Markup + inline Firebase SDK |
| `styles.css` | 2,858 | Presentation only |

All 47 functions share a single global `state` object and many manipulate the
DOM directly. There are two structural blockers to unit testing right now:

1. **No exports.** Functions are global; a test runner cannot import them
   without a workaround or small refactor.
2. **State coupling.** Core functions read from / write to the `state` variable
   in module scope. Tests must set up that variable before each case.

Both are solvable without changing any observable behaviour for end users.

---

## ROI Framework — What to Test and Why

Before writing any test, ask three questions:

| Question | Filter |
|----------|--------|
| What bug does this prevent? | Skip if the answer is "none likely" |
| How costly is that bug? | Prioritise financial errors over cosmetic ones |
| Is it already covered indirectly? | Skip pure render functions; E2E covers them |

Applying this to the codebase produces four priority bands:

| Priority | Area | ROI Rationale |
|----------|------|---------------|
| **P0** | Core financial logic | Wrong numbers = broken product trust, potential financial harm |
| **P1** | Data integrity (load/sanitize) | Silent corruption at startup = hard-to-debug data loss |
| **P2** | Pure utility functions | Zero-setup tests, reused everywhere, high catch rate |
| **P3** | E2E critical user flows | Catches regressions that unit tests can't see |

---

## Testing Infrastructure — Recommended Setup

### Step 1: Add `package.json`

```json
{
  "name": "gcfinance",
  "type": "module",
  "scripts": {
    "test":          "vitest run",
    "test:watch":    "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest":            "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "jsdom":             "^25.0.0"
  }
}
```

### Step 2: Add `vitest.config.js`

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['lib.js'],
      thresholds: {
        statements: 70,
        branches:   65,
        functions:  70,
        lines:      70,
      },
    },
  },
})
```

### Step 3: Extract testable code into `lib.js`

Create a new `lib.js` that exports the pure/logic functions (no DOM, no global
`state`). Update `app.js` to import from `lib.js`. No user-facing change.

Functions to move into `lib.js`:

- `normalizeAmount`
- `escapeHtml`
- `flattenSubGoals`
- `inferTypeFromName`
- `makeId`
- `dateLabel`
- `deriveState` — extract the pure computation; keep the `state`-reading wrapper in `app.js`
- `sanitizeState` — extract the validation logic as a pure function taking a state object
- `addOrUpdateAllocation` — extract the merge/append decision as a pure function
- `autoAssignReadyCash` — extract the allocation algorithm as a pure function

---

## P2 — Utility Functions (Start Here)

These are pure functions with no side effects. They take an input and return an
output. Write these tests first: they require zero setup, run in milliseconds,
and validate the building blocks every other function depends on.

### `normalizeAmount(value)`

Used for every financial figure stored or displayed. The coercion rules are
intentional but must be pinned down.

**Target coverage: 100%**

| Input | Expected output | Why it matters |
|-------|----------------|----------------|
| `500` | `500` | Positive integer passthrough |
| `1.7` | `2` | Rounds up (Math.round) |
| `1.4` | `1` | Rounds down |
| `-50` | `0` | Negatives floored to 0 |
| `0` | `0` | Zero identity |
| `"500"` | `500` | String coercion (used from input fields) |
| `""` | `0` | Empty string → 0 |
| `null` | `0` | Null safety |
| `undefined` | `0` | Undefined safety |
| `NaN` | `0` | NaN safety |
| `Infinity` | `Infinity` | Edge case: document or guard if undesired |

### `escapeHtml(value)`

Every piece of user-supplied text rendered into `innerHTML` passes through
this. A missed escape is an XSS vulnerability.

**Target coverage: 100%**

| Input | Expected output |
|-------|----------------|
| `"&"` | `"&amp;"` |
| `"<"` | `"&lt;"` |
| `">"` | `"&gt;"` |
| `'"'` | `"&quot;"` |
| `"'"` | `"&#39;"` |
| `"<script>alert(1)</script>"` | fully escaped string |
| `""` | `""` |
| `42` (number) | `"42"` (coerced to string) |

### `flattenSubGoals(goals)`

Powers allocation dropdowns and `deriveState` aggregation. An off-by-one in
indices breaks goal rendering and allocation matching.

**Target coverage: 100%**

| Scenario | Assertion |
|----------|-----------|
| Single goal, one sub-goal | Returns list of length 1; `goalIndex=0`, `subIndex=0`, correct `goalId`/`goalName` |
| Two goals, two sub-goals each | Returns list of length 4; indices increment correctly |
| Empty goals array | Returns `[]` |
| Goal with zero sub-goals | Contributes nothing to output |

### `inferTypeFromName(name)`

Used in `sanitizeState` to guess a missing account type from its name. Wrong
inference puts accounts in the wrong display group.

**Target coverage: 100%**

| Input | Expected output | Priority keyword |
|-------|----------------|-----------------|
| `"My ISA"` | `"ISA"` | `isa` (highest priority) |
| `"Joint Account Savings"` | `"Joint Account"` | `joint` beats `saving` |
| `"Rainy Day Savings"` | `"Savings"` | `saving` |
| `"Main Current"` | `"Current Account"` | `current` |
| `"Credit Card Backup"` | `"Credit Card"` | `credit` |
| `"Pension Plan"` | `"Other"` | no keyword match |
| `"SAVINGS"` | `"Savings"` | case-insensitive |
| `""` | `"Other"` | empty string |
| `null` | `"Other"` | `(null \|\| "")` guard |
| `undefined` | `"Other"` | `(undefined \|\| "")` guard |

---

## P0 — Core Financial Logic

These functions produce every number the user sees. A silent bug here shows
wrong balances or misallocates money without throwing an error.

**Target coverage: 95%+ branch coverage**

### `deriveState(stateSnapshot)`

The single most important function. Every displayed number flows from here.

| Scenario | What to assert |
|----------|---------------|
| Basic: two accounts, one goal, one allocation | `totalFunds`, `totalAssigned`, `readyToAssign`, `overallProgress` are all correct |
| Multiple allocations to the same sub-goal | Amounts are summed, not duplicated |
| Allocation references deleted account | Ignored; does not contribute to totals |
| Allocation references deleted sub-goal | Ignored |
| `readyToAssign` < 0 (over-allocation) | Returned as a negative number (visible to user as a warning) |
| `overallProgress` when assigned > target | Capped at 100 |
| Individual sub-goal `progress` when assigned > target | Capped at 100 |
| Empty state (no accounts, no goals) | All totals zero; no exception thrown |
| Goal with `target = 0` | `progress = 0`; no divide-by-zero |

### `addOrUpdateAllocation(accountId, subGoalId, amountToAdd)`

The state mutation called by both `assignFunds` and `autoAssignReadyCash`.
Merge vs. append behaviour is invisible in the UI but critical for correctness.

| Scenario | What to assert |
|----------|---------------|
| No existing allocation for the pair | New entry appended to `allocations` array |
| Existing allocation for same `(accountId, subGoalId)` | Amount is summed (not duplicated), only one entry in array |
| `amountToAdd = 0` | Early return; state unchanged |
| `amountToAdd` is a float (e.g. `1.7`) | Stored as `2` after `normalizeAmount` |

### `assignFunds(accountId, subGoalId, requestedAmount)`

Richest branching logic in the file. Each branch must be verified
independently.

| Scenario | Expected outcome |
|----------|----------------|
| Happy path: funds and capacity both sufficient | `addOrUpdateAllocation` called with `requestedAmount`; success toast |
| `requestedAmount > account.available` | Capped to `available`; partial toast shown |
| `requestedAmount > subGoal.remaining` | Capped to `remaining`; partial toast shown |
| `requestedAmount = 0` | Error toast; no allocation created |
| `requestedAmount < 0` | Treated as 0; error toast |
| `accountId` not found in derived state | Error toast; no allocation |
| `subGoalId` not found in derived state | Error toast; no allocation |
| `account.available <= 0` | "Insufficient Funds" toast; no allocation |
| `subGoal.remaining <= 0` | "Goal Funded" toast; no allocation |
| Completing a sub-goal (`remaining - applied <= 0`) | `triggerConfetti` called |

### `autoAssignReadyCash()`

Iterates accounts and sub-goals sequentially. The local `remainingBySubGoal`
tracking must stay consistent with what gets committed to `state.allocations`.

| Scenario | What to assert |
|----------|---------------|
| Single account, single sub-goal; balance ≥ target | Sub-goal fully funded; correct allocation amount |
| Single account, multiple sub-goals | Earlier sub-goals filled first; remainder goes to next |
| Multiple accounts, single sub-goal | First account fills it; second account contributes nothing |
| Multiple accounts, multiple sub-goals | Funds spread correctly across accounts and goals |
| No available funds | "No Funds" toast; no allocations added |
| All sub-goals already funded | "All Done!" toast; no allocations added |
| Partial funding (funds run out before all goals filled) | Correct partial allocations; no over-allocation |
| Account exhausted mid-loop | Does not over-allocate; moves to next account |
| `assignedTotal` | Equals the sum of all allocation amounts added |

---

## P1 — Data Integrity

These functions run at startup and when receiving cloud data. Bugs here corrupt
persisted state silently and are the hardest to debug.

**Target coverage: 90%+ branch coverage**

### `loadState()`

Cold-start function. Its fallback behaviour is the last defence against corrupt
localStorage.

| Scenario | Expected return |
|----------|----------------|
| No key in localStorage | Deep clone of `DEFAULT_DATA` |
| Valid JSON with all required arrays | Parsed object returned |
| Valid JSON missing `accounts` array | Falls back to `DEFAULT_DATA` |
| Valid JSON missing `goals` array | Falls back to `DEFAULT_DATA` |
| Valid JSON missing `allocations` array | Falls back to `DEFAULT_DATA` |
| Corrupt JSON (`"{"`) | Exception caught silently; returns `DEFAULT_DATA` |
| Missing `monthlyProgress` | Backfilled to 12 months of zeroes |
| Missing `progressYear` | Backfilled to current year |

### `sanitizeState(stateSnapshot)`

Runs after every load. Removes orphaned allocations, backfills missing IDs,
normalises amounts, and migrates old field names.

| Scenario | What to assert |
|----------|---------------|
| Allocation references non-existent `accountId` | Removed from `allocations` |
| Allocation references non-existent `subGoalId` | Removed from `allocations` |
| Allocation with `amount = 0` | Removed |
| Account without `id` | Gets a generated id |
| Account `owner` not in `["Gary","Catherine","Joint"]` | Defaulted to `"Joint"` |
| Account `balance = -500` | Normalised to `0` |
| Sub-goal `target = -100` | Normalised to `0` |
| Legacy `monthlyProgress` with `planned`/`actual` | Migrated to `plannedGary`/`actualGary`; values preserved |
| Missing `progressYear` | Backfilled with current year |
| `monthlyProgress` array length < 12 or > 12 | Rebuilt from scratch |

---

## P3 — E2E Critical User Flows (Playwright)

Unit tests cannot catch regressions that span event wiring, DOM rendering, and
state persistence together. These nine flows should be covered with Playwright
tests run against a local server.

| Flow | Why it's critical |
|------|--------------------|
| Add an account via the wizard (all steps) | Multi-step state machine; skipping a step leaves corrupt data |
| Edit an account balance inline; verify summary cards update | Core data-entry loop |
| Create a goal with a sub-goal via the wizard | Affects allocation dropdowns |
| Manually assign funds from an account to a sub-goal | Primary user action |
| Auto-assign distributes remaining funds correctly | Algorithm correctness visible in UI |
| Remove an allocation and verify balances recalculate | Ledger editing |
| State persists across a page reload | localStorage round-trip |
| Reset data restores defaults | Destructive action with confirmation dialog |
| Simple mode toggle shows/hides correct sections | UI-mode switching |

**Suggested tool:** Playwright (already familiar to the team; `output/playwright/`
screenshots confirm prior exploration).

---

## What NOT to Test

| Category | Examples | Reason |
|----------|----------|--------|
| Render functions | `renderAccounts`, `renderGoals`, etc. | DOM assertions are brittle; covered by E2E |
| Animation helpers | `animateValue`, `triggerConfetti` | Visual/timing; not business logic |
| Toast display | `showToast` | Tested indirectly via E2E |
| Firebase / cloud sync | `initCloudSync`, `saveState` cloud path | Third-party SDK; mock at the boundary |
| Constants | `MONTHS`, `OWNERS`, `DEFAULT_DATA` | No logic |
| `makeId` randomness | — | Non-deterministic; only verify it returns a non-empty string |

---

## Coverage Targets

| Layer | Target | Rationale |
|-------|--------|-----------|
| P0 core financial logic | 95%+ branch | Financial correctness is non-negotiable |
| P1 data integrity | 90%+ branch | Silent corruption is catastrophic |
| P2 utility functions | 100% | Pure functions; trivial to achieve |
| E2E critical flows | All 9 passing | Integration confidence |

A global threshold of **70% line coverage** is a reasonable CI gate once the
above layers are covered, since untested code will mostly be render and UI
helpers that intentionally fall outside scope.

---

## Recommended Sequence

1. Add `package.json`, `vitest.config.js`, and run `npm install`.
2. Extract pure functions into `lib.js` as named exports; import from `app.js`.
3. Write P2 utility tests first (no state setup needed; fastest wins).
4. Write P0 core financial logic tests with explicit state fixtures.
5. Write P1 data integrity tests with mocked `localStorage`.
6. Add Playwright config and cover the 9 E2E flows.
7. Add coverage thresholds to CI so regressions are caught automatically.
