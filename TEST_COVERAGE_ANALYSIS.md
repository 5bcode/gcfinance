# Test Coverage Analysis — SavinCGs (gcfinance)

**Date**: 2026-02-20
**Branch**: `claude/analyze-test-coverage-Z6kcX`

---

## Current State

**Test coverage: 0%**

There are no test files, no test runner, and no test configuration anywhere in the project. The `output/playwright/` directory contains UI screenshots (likely generated manually), but there are no Playwright test scripts.

The entire application lives in a single 2103-line `app.js` loaded as a global script, plus inline Firebase code in `index.html`. All functions share a single global `state` object and many manipulate the DOM directly, which makes testing non-trivial but far from impossible.

---

## Testing Infrastructure Gap

Before writing any tests, the project needs a test setup. Recommended approach:

1. **Add `package.json`** with [Vitest](https://vitest.dev/) + `jsdom` for unit/integration tests of logic functions (no build step required, handles ES2022 well).
2. **Add Playwright** for E2E tests of critical user flows (the `output/playwright` directory suggests this tooling is already familiar).

The two biggest structural obstacles to unit testing right now are:
- All functions are global (no `export`), so they can't be imported by a test runner without refactoring or using a workaround like `globalThis` injection.
- Several core functions read from / write to the global `state` variable directly, meaning tests must set up that variable before each case.

Both are manageable. The recommended path is to extract pure business-logic functions into a separate `lib.js` ES module that `app.js` imports. This has zero user-facing impact and makes those functions directly testable.

---

## Priority Matrix

| Priority | Area | Why |
|----------|------|-----|
| P0 | Core financial logic (`deriveState`, `assignFunds`, `autoAssignReadyCash`, `addOrUpdateAllocation`) | Wrong numbers = broken product |
| P1 | Data integrity (`sanitizeState`, `loadState`) | Corrupt persisted state = data loss |
| P2 | Utility functions (`normalizeAmount`, `escapeHtml`, `flattenSubGoals`, `inferTypeFromName`) | High reuse across the codebase |
| P3 | E2E critical user flows | Catches regressions integration tests miss |

---

## P0 — Core Financial Logic

These functions are the heart of the app. A silent bug here shows wrong balances or misallocates money without any error being thrown.

### 1. `deriveState()` (line 317)

This is the single most important function in the codebase. Every number displayed in the UI — total funds, ready-to-assign, goal progress percentages — flows from here. It iterates allocations, aggregates by account and sub-goal, and computes derived totals.

**Missing test cases:**
- Basic happy path: two accounts, one goal, one allocation → correct totals
- Multiple allocations to the same sub-goal are summed correctly
- An allocation referencing a deleted account is ignored (it shouldn't contribute to totals)
- An allocation referencing a deleted sub-goal is ignored
- `readyToAssign` goes negative when allocations exceed account balance (over-allocation scenario)
- `overallProgress` caps at 100% even when assigned > target
- `progress` on an individual goal/sub-goal caps at 100%
- Empty state (no accounts, no goals) → all totals zero, no exceptions thrown
- Goal with zero target → `progress` is 0, no divide-by-zero

### 2. `assignFunds(accountId, subGoalId, requestedAmount)` (line 1365)

This function has the richest branching logic in the file. It validates inputs, derives live state, then decides how much to allocate.

**Missing test cases:**
- Happy path: assigns the requested amount when funds and sub-goal capacity are both sufficient
- Amount is capped to `account.available` when `requestedAmount > available` (partial allocation)
- Amount is capped to `subGoal.remaining` when `requestedAmount > remaining`
- `requestedAmount = 0` → shows error toast, no allocation created
- `requestedAmount < 0` → treated as 0 by `normalizeAmount`, shows error toast
- Invalid `accountId` (account not found in derived state) → shows error toast
- Invalid `subGoalId` → shows error toast
- `account.available <= 0` → "Insufficient Funds" toast, no allocation
- `subGoal.remaining <= 0` → "Goal Funded" toast, no allocation
- Completing a sub-goal (remaining hits 0) triggers `triggerConfetti`

### 3. `autoAssignReadyCash()` (line 1408)

The auto-assign algorithm iterates accounts in order, draining each account across open sub-goals sequentially. The tricky part is that it tracks `remainingBySubGoal` locally (not re-deriving from state on each loop), so the local accounting must stay consistent with what gets committed to `state.allocations`.

**Missing test cases:**
- Single account, single sub-goal: full allocation when account balance ≥ target
- Single account, multiple sub-goals: funds distributed in order, earlier sub-goals filled first
- Multiple accounts, single sub-goal: first account fills the sub-goal, second account contributes nothing
- Multiple accounts, multiple sub-goals: funds correctly spread across accounts and goals
- No available funds (`account.available = 0` for all) → "No Funds" toast, no allocations added
- All sub-goals already funded → "All Done!" toast, no allocations added
- Partial funding: funds run out before all sub-goals are filled → correct partial allocations
- An account that becomes exhausted mid-loop does not over-allocate
- `assignedTotal` correctly reflects the sum of all allocations made

### 4. `addOrUpdateAllocation(accountId, subGoalId, amountToAdd)` (line 1349)

This mutation is called by both `assignFunds` and `autoAssignReadyCash`. Its behaviour—merge vs. append—is invisible in the UI but critical for correctness.

**Missing test cases:**
- No existing allocation for the pair → new entry pushed to `state.allocations`
- Existing allocation for the same `(accountId, subGoalId)` pair → amount is summed, not duplicated
- `amountToAdd = 0` → early return, state unchanged
- `amountToAdd` is a float (e.g. 1.7) → `normalizeAmount` rounds it to 2 before storing

---

## P1 — Data Integrity

These functions run at startup and when receiving cloud data. Bugs here corrupt the persisted state silently.

### 5. `sanitizeState()` (line 250)

Runs after loading state from localStorage or cloud. Removes orphaned allocations, backfills missing IDs, normalises amounts, and migrates old monthly-progress field names.

**Missing test cases:**
- Allocations referencing non-existent `accountId` are removed
- Allocations referencing non-existent `subGoalId` are removed
- Allocations with `amount = 0` are removed
- Accounts without an `id` get one generated
- Accounts with an `owner` not in `["Gary", "Catherine", "Joint"]` default to `"Joint"`
- Account `balance` of `-500` is normalised to `0`
- Sub-goal `target` of `-100` is normalised to `0`
- Old `monthlyProgress` shape (`planned`/`actual` per row) is migrated to `plannedGary`/`actualGary` correctly, preserving values
- Missing `progressYear` field is backfilled with the current year
- `monthlyProgress` array with wrong length (< 12 or > 12) is rebuilt from scratch

### 6. `loadState()` (line 62)

The cold-start function. Its fallback behaviour is the last line of defence against a corrupt localStorage.

**Missing test cases:**
- No key in localStorage → returns a deep clone of `DEFAULT_DATA`
- Valid JSON with required fields → returns parsed object
- Valid JSON missing `accounts` array → falls back to `DEFAULT_DATA`
- Valid JSON missing `goals` array → falls back to `DEFAULT_DATA`
- Valid JSON missing `allocations` array → falls back to `DEFAULT_DATA`
- Corrupt JSON (e.g. `"{"`) → exception caught silently, returns `DEFAULT_DATA`
- `monthlyProgress` missing from otherwise valid data → backfilled to 12 months of zeroes
- `progressYear` missing → backfilled to current year

---

## P2 — Utility Functions

Pure functions with no side effects. Very easy to test, high reuse.

### 7. `normalizeAmount(value)` (line 113)

Used for every financial figure stored or displayed. Silently coercing bad inputs is intentional, but the coercion rules must be verified.

**Missing test cases:**
- Positive integer → same value
- Float (e.g. `1.7`) → rounds to `2` (`Math.round`)
- Negative number → `0`
- `0` → `0`
- `"500"` (string) → `500`
- `""` (empty string) → `0`
- `null` → `0`
- `undefined` → `0`
- `NaN` → `0`
- `Infinity` → `Infinity` (current behaviour — worth documenting or guarding)

### 8. `escapeHtml(value)` (line 117)

Every piece of user-supplied text rendered into innerHTML goes through this. A missed escape sequence is an XSS vulnerability.

**Missing test cases:**
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&#39;`
- String with all five characters: `<a href="/" onclick='alert(1)'>` → fully escaped
- Empty string → `""`
- Non-string input (e.g. a number) → coerced to string then escaped

### 9. `flattenSubGoals(goals)` (line 134)

Powers the allocation dropdowns and the `deriveState` aggregation. An off-by-one in indices breaks goal rendering.

**Missing test cases:**
- Single goal with one sub-goal → list of length 1 with correct `goalId`, `goalName`, `goalIndex=0`, `subIndex=0`
- Two goals, two sub-goals each → list of length 4 with correct indices
- Empty goals array → empty list
- Goal with zero sub-goals → contributes nothing to the output list

### 10. `inferTypeFromName(name)` (line 157)

Used in `sanitizeState` to guess a missing account type from its name. Wrong inference means accounts are sorted into the wrong table group.

**Missing test cases:**
- `"My ISA"` → `"ISA"`
- `"Joint Account Savings"` → `"Joint Account"` (contains "joint", which takes priority over "saving")
- `"Rainy Day Savings"` → `"Savings"`
- `"Main Current"` → `"Current Account"`
- `"Credit Card Backup"` → `"Credit Card"`
- `"Pension"` (no keyword match) → `"Other"`
- Case-insensitivity: `"SAVINGS"` → `"Savings"`
- Empty string → `"Other"`
- `null` / `undefined` → `"Other"` (the function does `(name || "").toLowerCase()`, so this should be safe — confirm it)

---

## P3 — E2E Critical User Flows (Playwright)

Unit tests cannot catch regressions that span event wiring, DOM rendering, and state persistence together. These flows should be covered with Playwright tests.

**Flows to cover:**

| Flow | Why it's critical |
|------|-------------------|
| Add an account via the wizard (all 5 steps) | Wizard state machine has multiple steps; skipping one leaves corrupt data |
| Edit an account's balance inline and verify summary cards update | Core data-entry loop |
| Create a goal with a sub-goal via the wizard | Goal creation affects allocation dropdowns |
| Manually assign funds from an account to a sub-goal | Primary user action |
| Auto-assign distributes remaining funds correctly | Algorithmic correctness visible in UI |
| Remove an allocation and verify balances recalculate | Ledger editing |
| State persists across a page reload | localStorage round-trip |
| Reset data restores defaults | Destructive action with confirmation dialog |
| Simple mode toggle shows/hides correct sections | UI-mode switching |

---

## What Not to Test

| Category | Examples | Reason |
|----------|----------|--------|
| Pure render functions (`renderAccounts`, `renderGoals`, etc.) | All `render*` functions | DOM assertions are brittle; covered by E2E |
| Animation helpers | `animateValue`, `triggerConfetti` | Visual/timing; not business logic |
| Toast display | `showToast` | UI feedback; tested indirectly via E2E |
| Firebase/cloud sync internals | `syncToCloud`, `startCloudSync` | Third-party SDK; mock at integration boundary |
| Constants and configuration | `MONTHS`, `OWNERS`, `DEFAULT_DATA` | No logic |
| `makeId` randomness | — | Non-deterministic; just verify it returns a non-empty string with the given prefix |

---

## Suggested Coverage Targets

Once infrastructure is in place:

| Layer | Target |
|-------|--------|
| P0 core financial logic | 95%+ branch coverage |
| P1 data integrity | 90%+ branch coverage |
| P2 utility functions | 100% (they're small and pure) |
| E2E critical flows | All 9 flows listed above passing |

---

## Recommended First Steps

1. Add `package.json` with `vitest` and `@vitest/coverage-v8` as dev dependencies.
2. Extract the pure functions (`normalizeAmount`, `escapeHtml`, `flattenSubGoals`, `inferTypeFromName`, `deriveState` logic, `addOrUpdateAllocation` logic, `sanitizeState` logic) into `lib.js` as named exports.
3. Import `lib.js` from `app.js` so runtime behaviour is unchanged.
4. Write unit tests for P2 utilities first (easiest wins, no state setup needed).
5. Write unit tests for P0/P1 functions with explicit state fixtures.
6. Add Playwright config and cover the 9 E2E flows.
7. Wire coverage reporting into CI so regressions are caught automatically.
