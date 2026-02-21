const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const STORAGE_KEY = "gcfinance-v1";
const SIMPLE_MODE_KEY = "gcfinance-simple-mode";

const OWNERS = ["Gary", "Catherine", "Joint"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ACCOUNT_TYPES = ["Current Account", "Savings", "ISA", "Credit Card", "Other"];

const DEFAULT_DATA = {
  accounts: [
    { id: "acct-gary-current", name: "Main Hub", type: "Current Account", provider: "Monzo", owner: "Gary", balance: 0 },
    { id: "acct-gary-savings", name: "Rainy Day", type: "Savings", provider: "Monzo", owner: "Gary", balance: 0 },
    { id: "acct-cat-current", name: "Daily Spend", type: "Current Account", provider: "Barclays", owner: "Catherine", balance: 0 },
    { id: "acct-cat-savings", name: "Backup", type: "Savings", provider: "Barclays", owner: "Catherine", balance: 0 },
    { id: "acct-joint-isa", name: "Future Fund", type: "Joint Account", provider: "Nationwide", owner: "Joint", balance: 0 },
  ],
  goals: [
    {
      id: "goal-house",
      name: "House Purchase",
      subGoals: [
        { id: "sg-house-deposit", name: "Deposit", target: 40000 },
        { id: "sg-house-solicitor", name: "Solicitor Fees", target: 3000 },
        { id: "sg-house-survey", name: "Survey", target: 800 },
        { id: "sg-house-moving", name: "Moving Costs", target: 1500 },
      ],
    },
    {
      id: "goal-holiday",
      name: "Holiday",
      subGoals: [
        { id: "sg-holiday-flights", name: "Flights", target: 1200 },
        { id: "sg-holiday-accom", name: "Accommodation", target: 1500 },
        { id: "sg-holiday-spending", name: "Spending Money", target: 800 },
      ],
    },
    {
      id: "goal-emergency",
      name: "Emergency Fund",
      subGoals: [
        { id: "sg-emergency-buffer", name: "6-Month Buffer", target: 10000 },
      ],
    },
  ],
  allocations: [],
  monthlyProgress: MONTHS.map((month) => ({ month, plannedGary: 0, actualGary: 0, plannedCat: 0, actualCat: 0, notes: "" })),
  progressYear: new Date().getFullYear(),
};

// ── State ──────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && Array.isArray(parsed.accounts) && Array.isArray(parsed.goals) && Array.isArray(parsed.allocations)) {
        // Backfill monthlyProgress for old data
        if (!Array.isArray(parsed.monthlyProgress)) {
          parsed.monthlyProgress = MONTHS.map((month) => ({ month, planned: 0, actual: 0, notes: "" }));
        }
        if (!parsed.progressYear) {
          parsed.progressYear = new Date().getFullYear();
        }
        return parsed;
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return structuredClone(DEFAULT_DATA);
}

let _skipCloudSync = false; // Guard to prevent sync loop

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors (private mode etc.)
  }

  // Sync to cloud if available (skip if this save was triggered by incoming cloud data)
  if (!_skipCloudSync && window.cloudSync && window.cloudSync.isEnabled()) {
    window.cloudSync.syncToCloud(state);
  }
}

let state = loadState();

// ── UI state (not persisted) ───────────────────────────────────────────────────
let acctOwnerFilter = new Set(OWNERS); // which owners to show; all active by default
let acctEditMode = false;              // whether the accounts table is in edit mode
let editingGoalIds = new Set();        // set of goal IDs currently in edit mode
let simpleMode = localStorage.getItem(SIMPLE_MODE_KEY) === "true"; // simple mode hides details, shows totals

// ── Utilities ──────────────────────────────────────────────────────────────────

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAmount(value) {
  return Math.round(Math.max(0, Number(value) || 0));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dateLabel(date = new Date()) {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function flattenSubGoals(goals) {
  const list = [];
  goals.forEach((goal, goalIndex) => {
    goal.subGoals.forEach((subGoal, subIndex) => {
      list.push({
        ...subGoal,
        goalId: goal.id,
        goalName: goal.name,
        goalIndex,
        subIndex,
      });
    });
  });
  return list;
}

function ownerSelectHtml(selected, label) {
  return `<select data-field="owner" aria-label="${label || "Account owner"}">${OWNERS.map(
    (o) => `<option value="${o}"${o === selected ? " selected" : ""}>${escapeHtml(o)}</option>`,
  ).join("")}</select>`;
}

// ── Animations & Feedback ────────────────────────────────────────────────────
function inferTypeFromName(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("isa")) return "ISA";
  if (n.includes("joint")) return "Joint Account";
  if (n.includes("saving")) return "Savings";
  if (n.includes("current")) return "Current Account";
  if (n.includes("credit")) return "Credit Card";
  return "Other";
}
function triggerConfetti() {
  if (typeof confetti === "function") {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#7c3aed", "#10b981", "#06b6d4"],
    });
  }
}

function showToast(title, message, type = "success") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;

  const iconMap = {
    success: "✓",
    info: "ℹ",
    error: "✕",
  };

  toast.innerHTML = `
    <div class="toast-icon">${iconMap[type] || "•"}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.classList.add("hiding");
    toast.addEventListener("animationend", () => toast.remove());
  }, 4000);
}

function animateValue(id, start, end, duration = 800) {
  const obj = document.getElementById(id);
  if (!obj) return;

  // Use a data attribute to store the current displayed value to avoid jumps
  const current = parseFloat(obj.getAttribute("data-value")) || start;
  if (current === end) return;

  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);

    // Ease out quart
    const ease = 1 - Math.pow(1 - progress, 4);

    const val = current + (end - current) * ease;
    obj.innerHTML = GBP.format(val);
    obj.setAttribute("data-value", val);

    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      obj.innerHTML = GBP.format(end);
    }
  };
  window.requestAnimationFrame(step);
}

function toggleGoalEdit(goalId) {
  if (editingGoalIds.has(goalId)) {
    editingGoalIds.delete(goalId);
  } else {
    editingGoalIds.add(goalId);
  }
  renderApp();
}


function sanitizeState() {
  const accountIds = new Set();
  state.accounts = state.accounts.map((account, idx) => {
    const next = {
      ...account,
      id: account.id || makeId("acct"),
      name: String(account.name || `Account ${idx + 1}`).trim() || `Account ${idx + 1}`,
      type: account.type || inferTypeFromName(account.name),
      provider: String(account.provider || "").trim(),
      owner: OWNERS.includes(account.owner) ? account.owner : "Joint",
      balance: normalizeAmount(account.balance),
    };
    accountIds.add(next.id);
    return next;
  });

  const subGoalIds = new Set();
  state.goals = state.goals.map((goal, idx) => {
    const cleanGoal = {
      ...goal,
      id: goal.id || makeId("goal"),
      name: String(goal.name || `Goal ${idx + 1}`).trim() || `Goal ${idx + 1}`,
      subGoals: goal.subGoals.map((subGoal, subIdx) => {
        const cleanSubGoal = {
          ...subGoal,
          id: subGoal.id || makeId("sg"),
          name: String(subGoal.name || `Sub-goal ${subIdx + 1}`).trim() || `Sub-goal ${subIdx + 1}`,
          target: normalizeAmount(subGoal.target),
        };
        subGoalIds.add(cleanSubGoal.id);
        return cleanSubGoal;
      }),
    };
    return cleanGoal;
  });

  state.allocations = state.allocations
    .map((allocation) => ({
      ...allocation,
      id: allocation.id || makeId("alloc"),
      amount: normalizeAmount(allocation.amount),
    }))
    .filter((allocation) => {
      return allocation.amount > 0 && accountIds.has(allocation.accountId) && subGoalIds.has(allocation.subGoalId);
    });

  // Sanitise monthly progress
  if (!Array.isArray(state.monthlyProgress) || state.monthlyProgress.length !== 12) {
    state.monthlyProgress = MONTHS.map((month) => ({ month, planned: 0, actual: 0, notes: "" }));
  }
  state.monthlyProgress = state.monthlyProgress.map((entry, i) => {
    // Default to existing values (migration) or 0
    // We map legacy 'planned'/'actual' to Gary's column to preserve totals in charts
    const pGary = entry.plannedGary ?? entry.planned ?? 0;
    const aGary = entry.actualGary ?? entry.actual ?? 0;
    return {
      month: MONTHS[i],
      plannedGary: normalizeAmount(pGary),
      actualGary: normalizeAmount(aGary),
      plannedCat: normalizeAmount(entry.plannedCat),
      actualCat: normalizeAmount(entry.actualCat),
      notes: String(entry.notes || "").trim(),
    };
  });
  if (!state.progressYear) state.progressYear = new Date().getFullYear();
}

function deriveState() {
  const subGoals = flattenSubGoals(state.goals);
  const subGoalById = new Map(subGoals.map((subGoal) => [subGoal.id, subGoal]));
  const accountById = new Map(state.accounts.map((account) => [account.id, account]));

  const accountAssigned = new Map(state.accounts.map((account) => [account.id, 0]));
  const subGoalAssigned = new Map(subGoals.map((subGoal) => [subGoal.id, 0]));

  state.allocations.forEach((allocation) => {
    const amount = normalizeAmount(allocation.amount);
    if (!amount || !accountById.has(allocation.accountId) || !subGoalById.has(allocation.subGoalId)) return;

    accountAssigned.set(allocation.accountId, (accountAssigned.get(allocation.accountId) || 0) + amount);
    subGoalAssigned.set(allocation.subGoalId, (subGoalAssigned.get(allocation.subGoalId) || 0) + amount);
  });

  const accountsDerived = state.accounts.map((account) => {
    const assigned = accountAssigned.get(account.id) || 0;
    const available = account.balance - assigned;
    return { ...account, assigned, available };
  });

  const goalsDerived = state.goals.map((goal) => {
    const target = goal.subGoals.reduce((sum, subGoal) => sum + normalizeAmount(subGoal.target), 0);
    const assigned = goal.subGoals.reduce((sum, subGoal) => sum + (subGoalAssigned.get(subGoal.id) || 0), 0);
    const remaining = Math.max(0, target - assigned);
    const progress = target ? Math.min(100, Math.round((assigned / target) * 100)) : 0;
    return { ...goal, target, assigned, remaining, progress };
  });

  const subGoalsDerived = subGoals.map((subGoal) => {
    const assigned = subGoalAssigned.get(subGoal.id) || 0;
    const target = normalizeAmount(subGoal.target);
    const remaining = Math.max(0, target - assigned);
    const progress = target ? Math.min(100, Math.round((assigned / target) * 100)) : 0;
    return { ...subGoal, target, assigned, remaining, progress };
  });

  const totalFunds = accountsDerived.reduce((sum, account) => sum + account.balance, 0);
  const totalAssigned = accountsDerived.reduce((sum, account) => sum + account.assigned, 0);
  const readyToAssign = totalFunds - totalAssigned;
  const totalTarget = goalsDerived.reduce((sum, goal) => sum + goal.target, 0);
  const underFunded = subGoalsDerived.reduce((sum, subGoal) => sum + subGoal.remaining, 0);
  const overallProgress = totalTarget ? Math.min(100, Math.round((totalAssigned / totalTarget) * 100)) : 0;

  return {
    subGoalById,
    accountsDerived,
    goalsDerived,
    subGoalsDerived,
    totalFunds,
    totalAssigned,
    readyToAssign,
    underFunded,
    overallProgress,
  };
}

// ── Render ─────────────────────────────────────────────────────────────────────

function setAllocatorMessage(text, type = "success") {
  // Deprecated in favour of toasts, but kept for fallback or specific inline uses if needed
  // showToast(type === "warn" ? "Attention" : "Update", text, type === "warn" ? "error" : "success");
}

function renderSummary(derived) {
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  setText("asOfDate", dateLabel());
  /* 
   * Use simplified animation approach:
   * We store previous values in a closure or global cache would be better, 
   * but reading DOM data-value attribute is sufficient for this simple app.
   */
  const updateMetric = (id, val) => animateValue(id, 0, val);

  setText("asOfDate", dateLabel());
  updateMetric("totalFundsValue", derived.totalFunds);

  // Special handling for Ready To Assign to emphasize 0 (good job) or positive (task to do)
  const readyVal = derived.readyToAssign;
  updateMetric("readyToAssignValue", readyVal);

  updateMetric("totalAssignedValue", derived.totalAssigned);
  updateMetric("underFundedValue", derived.underFunded);

  // Animate percentage
  const progEl = document.getElementById("overallProgressValue");
  if (progEl) {
    /* Simple text update for % for now, could animate too */
    progEl.textContent = `${derived.overallProgress}%`;
  }

  const meter = document.getElementById("overallProgressBar");
  if (meter) meter.style.width = `${derived.overallProgress}%`;

  const ready = document.getElementById("readyToAssignValue");
  if (ready) ready.classList.toggle("negative", derived.readyToAssign < 0);

}

// Owner colour tokens used in the table
const OWNER_COLORS = { Gary: "gary", Catherine: "catherine", Joint: "joint" };

function renderAccounts(derived) {
  const tbody = document.getElementById("accountsTbody");
  const filterBar = document.getElementById("accountFilterBar");
  if (!tbody) return;

  // ── Sync data-edit attribute on the table ─────────────────────────────────
  const accountsTable = document.getElementById("accountsTable");
  if (accountsTable) accountsTable.setAttribute("data-edit", acctEditMode ? "true" : "false");

  // ── Render filter pills ───────────────────────────────────────────────────
  if (filterBar) {
    const allActive = OWNERS.every((o) => acctOwnerFilter.has(o));
    filterBar.innerHTML =
      OWNERS.map((o) => {
        const active = acctOwnerFilter.has(o);
        return `<button type="button" class="filter-pill filter-pill--${OWNER_COLORS[o] || "other"}${active ? " active" : ""}" data-filter-owner="${escapeHtml(o)}">${escapeHtml(o)}</button>`;
      }).join("");
  }

  if (!derived.accountsDerived.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5"><div class="empty-state"><div class="empty-state-icon">🏦</div><span class="empty-state-text">No accounts yet</span><span class="empty-state-hint">Add an account to start tracking your funds</span></div></td></tr>';
    return;
  }

  // ── Filter by active owners ───────────────────────────────────────────────
  const visible = derived.accountsDerived.filter((a) => acctOwnerFilter.has(a.owner));

  if (!visible.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5"><div class="empty-state"><div class="empty-state-icon">🔍</div><span class="empty-state-text">No accounts match this filter</span><span class="empty-state-hint">Try selecting a different owner</span></div></td></tr>';
    return;
  }

  // ── Group by 'type' (with fallback to Name) ──────────────────────────────
  const typeMap = new Map();
  visible.forEach((account) => {
    const key = account.type || account.name || "Other";
    if (!typeMap.has(key)) typeMap.set(key, []);
    typeMap.get(key).push(account);
  });

  // Sort groups by predefined order, then alphabetical
  const typeOrder = ACCOUNT_TYPES.reduce((acc, t, i) => ({ ...acc, [t]: i }), {});
  const sortedTypes = [...typeMap.entries()].sort((a, b) => {
    const idxA = typeOrder[a[0]] ?? 999;
    const idxB = typeOrder[b[0]] ?? 999;
    if (idxA !== idxB) return idxA - idxB;
    return a[0].localeCompare(b[0]);
  });

  tbody.innerHTML = sortedTypes
    .map(([typeName, accounts]) => {
      const groupHeader =
        `<tr class="account-group-header"><td colspan="4"><span class="account-group-label">${escapeHtml(typeName)}</span></td></tr>`;

      // Sub-group accounts within this type by provider name
      const providerMap = new Map();
      accounts.forEach((account) => {
        const key = (account.provider || "").trim() || "\u2014";
        if (!providerMap.has(key)) providerMap.set(key, []);
        providerMap.get(key).push(account);
      });
      const sortedProviders = [...providerMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const multiProvider = providerMap.size > 1;

      const rows = sortedProviders.map(([providerName, provAccounts]) => {
        const subHeader = multiProvider
          ? `<tr class="account-provider-header"><td colspan="4"><span class="account-provider-label">${escapeHtml(providerName)}</span></td></tr>`
          : "";

        const provRows = provAccounts.map((account) => {
          const availableClass = account.available < 0 ? "number negative" : "number";
          const ownerKey = OWNER_COLORS[account.owner] || "other";

          const accountCell = acctEditMode
            ? `<div class="acct-cell-edit">
                <input data-field="provider" value="${escapeHtml(account.provider || "")}" placeholder="Provider\u2026" aria-label="Provider" />
                <select data-field="owner" class="owner-pill owner-pill--${ownerKey}" aria-label="Account owner">${OWNERS.map(
              (o) => `<option value="${o}"${o === account.owner ? " selected" : ""}>${escapeHtml(o)}</option>`
            ).join("")}</select>
              </div>`
            : `<div class="acct-cell-view">
                <span class="acct-provider">${escapeHtml(account.provider || "\u2014")}</span>
                <span class="owner-pill-label owner-pill-label--${ownerKey}">${escapeHtml(account.owner)}</span>
              </div>`;

          const balanceCell = acctEditMode
            ? `<input data-field="balance" class="number" type="number" min="0" step="50" value="${account.balance}" aria-label="Account balance" />`
            : `<span class="acct-number">${GBP.format(account.balance)}</span>`;

          const removeCell = acctEditMode
            ? `<button type="button" class="row-remove" data-action="remove-account">Remove</button>`
            : ``;

          return `<tr data-account-id="${account.id}">
              <td>${accountCell}</td>
              <td class="number">${balanceCell}</td>
              <td class="${availableClass}">${GBP.format(account.available)}</td>
              <td>${removeCell}</td>
            </tr>`;
        }).join("");

        return subHeader + provRows;
      }).join("");

      return groupHeader + rows;
    })
    .join("");
}

function renderAllocationForm(derived) {
  const heroAssign = document.querySelector(".hero-assign");
  if (heroAssign) {
    heroAssign.hidden = derived.readyToAssign <= 0;
  }

  const accountSelect = document.getElementById("allocationAccount");
  const subGoalSelect = document.getElementById("allocationSubgoal");
  const amountInput = document.getElementById("allocationAmount");
  const form = document.getElementById("allocationForm");

  if (!accountSelect || !subGoalSelect || !amountInput || !form) return;

  const previousAccount = accountSelect.value;
  const previousSubGoal = subGoalSelect.value;

  const eligibleAccounts = derived.accountsDerived.filter((account) => account.available > 0);
  accountSelect.innerHTML = eligibleAccounts.length
    ? eligibleAccounts
      .map(
        (account) =>
          `<option value="${account.id}">${escapeHtml(account.owner)} – ${escapeHtml(account.name)}${account.provider ? ` (${escapeHtml(account.provider)})` : ""} — ${GBP.format(account.available)} available</option>`,
      )
      .join("")
    : '<option value="">No account has available cash</option>';

  if (eligibleAccounts.some((account) => account.id === previousAccount)) {
    accountSelect.value = previousAccount;
  }

  const openSubGoals = derived.subGoalsDerived.filter((subGoal) => subGoal.remaining > 0);
  subGoalSelect.innerHTML = openSubGoals.length
    ? openSubGoals
      .map(
        (subGoal) =>
          `<option value="${subGoal.id}">${escapeHtml(subGoal.goalName)} › ${escapeHtml(subGoal.name)} — ${GBP.format(subGoal.remaining)} left</option>`,
      )
      .join("")
    : '<option value="">All sub-goals are funded</option>';

  if (openSubGoals.some((subGoal) => subGoal.id === previousSubGoal)) {
    subGoalSelect.value = previousSubGoal;
  }

  const canAssign = eligibleAccounts.length > 0 && openSubGoals.length > 0;
  accountSelect.disabled = !eligibleAccounts.length;
  subGoalSelect.disabled = !openSubGoals.length;
  amountInput.disabled = !canAssign;

  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = !canAssign;
}

// Simple Mode: Render accounts summary by owner
function renderSimpleAccounts(derived) {
  const container = document.getElementById("simpleAccountsSummary");
  if (!container) return;

  // Calculate totals by owner
  const ownerTotals = { Gary: 0, Catherine: 0, Joint: 0 };
  derived.accountsDerived.forEach((account) => {
    if (ownerTotals.hasOwnProperty(account.owner)) {
      ownerTotals[account.owner] += account.balance;
    }
  });

  const ownerIcons = { Gary: "👤", Catherine: "👤", Joint: "🤝" };
  const ownerClasses = { Gary: "gary", Catherine: "catherine", Joint: "joint" };

  container.innerHTML = OWNERS.map((owner) => `
    <div class="simple-account-card simple-account-card--${ownerClasses[owner]}">
      <div class="owner-icon">${ownerIcons[owner]}</div>
      <div class="owner-name">${owner}</div>
      <div class="owner-total">${GBP.format(ownerTotals[owner])}</div>
    </div>
  `).join("");
}

// Simple Mode: Render goals overview with overall progress
function renderSimpleGoals(derived) {
  const board = document.getElementById("simpleGoalBoard");
  if (!board) return;

  if (!derived.goalsDerived.length) {
    board.innerHTML = '<p class="muted">No goals yet. Add one and break it down into sub-goals.</p>';
    return;
  }

  board.innerHTML = derived.goalsDerived
    .map((goal) => {
      const progress = goal.target > 0 ? Math.round((goal.assigned / goal.target) * 100) : 0;
      return `
        <article class="simple-goal-card">
          <div class="simple-goal-header">
            <span class="simple-goal-name">${escapeHtml(goal.name)}</span>
            <span class="simple-goal-progress-badge">${progress}%</span>
          </div>
          <div class="simple-goal-metrics">
            <div class="simple-goal-metric">
              <div class="simple-goal-metric-label">Target</div>
              <div class="simple-goal-metric-value">${GBP.format(goal.target)}</div>
            </div>
            <div class="simple-goal-metric">
              <div class="simple-goal-metric-label">Saved</div>
              <div class="simple-goal-metric-value">${GBP.format(goal.assigned)}</div>
            </div>
            <div class="simple-goal-metric">
              <div class="simple-goal-metric-label">Remaining</div>
              <div class="simple-goal-metric-value">${GBP.format(goal.remaining)}</div>
            </div>
          </div>
          <div class="simple-goal-progress-track">
            <div class="simple-goal-progress-fill" style="width: ${progress}%"></div>
          </div>
        </article>
      `;
    })
    .join("");
}

// Update simple mode visibility
function updateSimpleMode() {
  const body = document.body;
  const toggle = document.getElementById("simpleModeToggle");

  if (simpleMode) {
    body.classList.add("simple-mode");
    // Show simple mode sections
    document.querySelectorAll(".simple-mode-only").forEach((el) => el.removeAttribute("hidden"));
    // Hide detailed sections
    document.querySelectorAll(".simple-mode-hidden").forEach((el) => el.setAttribute("hidden", ""));
  } else {
    body.classList.remove("simple-mode");
    // Hide simple mode sections
    document.querySelectorAll(".simple-mode-only").forEach((el) => el.setAttribute("hidden", ""));
    // Show detailed sections
    document.querySelectorAll(".simple-mode-hidden").forEach((el) => el.removeAttribute("hidden"));
  }

  // Persist simple mode preference
  localStorage.setItem(SIMPLE_MODE_KEY, simpleMode);

  if (toggle) toggle.checked = simpleMode;
}

function renderAllocations(derived) {
  const tbody = document.getElementById("allocationsTbody");
  if (!tbody) return;

  if (!state.allocations.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📋</div><span class="empty-state-text">No allocations yet</span><span class="empty-state-hint">Use Quick Assign above to link funds to a goal</span></div></td></tr>';
    return;
  }

  const accountById = new Map(derived.accountsDerived.map((account) => [account.id, account]));

  tbody.innerHTML = state.allocations
    .map((allocation) => {
      const account = accountById.get(allocation.accountId);
      const subGoal = derived.subGoalById.get(allocation.subGoalId);
      if (!account || !subGoal) return "";

      return `
        <tr data-allocation-id="${allocation.id}">
          <td>${escapeHtml(account.owner)} – ${escapeHtml(account.name)}</td>
          <td>${escapeHtml(subGoal.goalName)} › ${escapeHtml(subGoal.name)}</td>
          <td><input class="number" type="number" min="0" step="50" value="${normalizeAmount(
        allocation.amount,
      )}" data-field="amount" aria-label="Allocation amount" /></td>
          <td><button type="button" class="row-remove" data-action="remove-allocation">Remove</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderGoals(derived) {
  const board = document.getElementById("goalBoard");
  if (!board) return;

  if (!derived.goalsDerived.length) {
    board.innerHTML = '<p class="muted">No goals yet. Add one and break it down into sub-goals.</p>';
    return;
  }

  board.innerHTML = derived.goalsDerived
    .map((goal) => {
      const isEditing = editingGoalIds.has(goal.id);

      const rows = goal.subGoals.length
        ? goal.subGoals
          .map((subGoal) => {
            const derivedSubGoal = derived.subGoalsDerived.find((item) => item.id === subGoal.id);
            if (!derivedSubGoal) return "";

            const nameCell = isEditing
              ? `<input data-field="subgoal-name" value="${escapeHtml(subGoal.name)}" aria-label="Sub-goal name" />`
              : `<span style="font-weight:500">${escapeHtml(subGoal.name)}</span>`;

            const targetCell = isEditing
              ? `<input data-field="subgoal-target" class="number" type="number" min="0" step="100" value="${derivedSubGoal.target}" aria-label="Sub-goal target" />`
              : `<span class="number" style="font-feature-settings:'tnum'">${GBP.format(derivedSubGoal.target)}</span>`;

            const actionsCell = isEditing
              ? `<button type="button" class="row-remove" data-action="remove-subgoal">Remove</button>`
              : `<button type="button" class="action-ghost" data-action="fill-subgoal">Assign</button>`;

            return `
                <tr data-goal-id="${goal.id}" data-subgoal-id="${subGoal.id}">
                  <td>${nameCell}</td>
                  <td>${targetCell}</td>
                  <td class="number">${GBP.format(derivedSubGoal.assigned)}</td>
                  <td class="number">${GBP.format(derivedSubGoal.remaining)}</td>
                  <td style="width: 120px;">
                    <div class="progress-track" aria-label="${derivedSubGoal.progress}% complete">
                      <div class="progress-fill" style="width:${derivedSubGoal.progress}%"></div>
                    </div>
                  </td>
                  <td>
                    <div class="subgoal-actions">
                      ${actionsCell}
                    </div>
                  </td>
                </tr>
              `;
          })
          .join("")
        : '<tr class="empty-row"><td colspan="6"><div class="empty-state"><div class="empty-state-icon">🎯</div><span class="empty-state-text">No sub-goals yet</span><span class="empty-state-hint">Add a sub-goal to start tracking progress</span></div></td></tr>';

      const headerName = isEditing
        ? `<input class="goal-name-input" data-field="goal-name" value="${escapeHtml(goal.name)}" aria-label="Goal name" style="margin:0; font-size:1.25rem; font-weight:700;" />`
        : `<h3 style="margin:0; font-size:1.25rem; font-weight:700;">${escapeHtml(goal.name)}</h3>`;

      const headerAction = isEditing
        ? `<button type="button" class="btn btn-primary btn-sm" data-action="save-goal">Done</button>
           <button type="button" class="btn-danger-soft btn-sm" data-action="remove-goal">Delete Goal</button>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-action="edit-goal">✏ Edit</button>`;

      const footerAction = isEditing
        ? `<button type="button" class="btn btn-secondary" data-action="add-subgoal">+ Add sub-goal</button>`
        : ``;

      return `
        <article class="goal-card" data-goal-id="${goal.id}" data-complete="${goal.progress >= 100}">
          <div class="goal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div style="flex:1; margin-right:16px;">${headerName}</div>
            <div style="display:flex; gap:8px;">${headerAction}</div>
          </div>

          <div class="goal-metrics">
            <span class="goal-chip chip-target">Target <b>${GBP.format(goal.target)}</b></span>
            <span class="goal-chip chip-assigned">Assigned <b>${GBP.format(goal.assigned)}</b></span>
            <span class="goal-chip chip-remaining" data-empty="${goal.remaining === 0}">Remaining <b>${GBP.format(goal.remaining)}</b></span>
            <span class="goal-chip funded-chip" data-progress="${goal.progress}">Funded <b>${goal.progress}%</b></span>
          </div>


          <div class="table-wrap">
            <table>
              <colgroup>
                <col style="width:26%">
                <col style="width:12%">
                <col style="width:13%">
                <col style="width:12%">
                <col style="width:15%">
                <col style="width:22%">
              </colgroup>
              <thead>
                <tr>
                  <th>Sub-goal</th>
                  <th class="number">Target</th>
                  <th class="number">Assigned</th>
                  <th class="number">Remaining</th>
                  <th>Progress</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          ${footerAction ? `<div class="goal-footer" style="margin-top: 20px; display: flex; justify-content: flex-end;">${footerAction}</div>` : ""}
        </article>

      `;
    })
    .join("");
}

// ── Charts ─────────────────────────────────────────────────────────────────────

function renderProgressChart(hoverIndex = -1) {
  const canvas = document.getElementById("progressChart");
  if (!canvas) return;
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0) return;

  const h = 380;
  // Use explicit width/height to avoid clearing if possible, but for simplicity always set
  if (canvas.width !== rect.width * dpr || canvas.height !== h * dpr) {
    canvas.width = rect.width * dpr;
    canvas.height = h * dpr;
  }

  const ctx = canvas.getContext("2d");
  ctx.resetTransform();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, h);

  const w = rect.width;
  const pad = { top: 24, right: 76, bottom: 46, left: 76 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const planned = state.monthlyProgress.map((e) => (e.plannedGary || 0) + (e.plannedCat || 0));
  const actual = state.monthlyProgress.map((e) => (e.actualGary || 0) + (e.actualCat || 0));
  const currentMonth = new Date().getMonth();

  // Accumulate
  let cumP = 0, cumA = 0;
  const cumPlanned = [];
  const cumActual = [];
  for (let i = 0; i < 12; i++) {
    cumP += planned[i];
    cumA += actual[i];
    cumPlanned.push(cumP);
    if (i <= currentMonth || actual[i] > 0) cumActual.push(cumA);
    else cumActual.push(null);
  }

  // Scales
  const maxMonthlyVal = Math.max(1, ...planned, ...actual);
  const maxMonthlyVisual = maxMonthlyVal / 0.42;
  const maxTotal = Math.max(1, cumP, cumA) * 1.05;

  const toX = (i) => pad.left + (chartW / 12) * i + (chartW / 24);
  const toY_Right = (v) => pad.top + chartH - (v / maxTotal) * chartH;
  const toY_Left = (v) => pad.top + chartH - (v / maxMonthlyVisual) * chartH;

  // ── Draw Grid & Axes ───────────────────────────────────────────────────────
  ctx.textBaseline = "middle";

  // Gridlines
  const gridCount = 5;
  for (let i = 0; i <= gridCount; i++) {
    const valRight = (maxTotal / gridCount) * i;
    const y = toY_Right(valRight);

    if (i > 0) {
      // Horizontal Line
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Right Tick & Label
      ctx.beginPath();
      ctx.moveTo(w - pad.right, y);
      ctx.lineTo(w - pad.right + 6, y);
      ctx.strokeStyle = "rgba(196,181,253,0.4)";
      ctx.stroke();

      const fmtR = valRight >= 1000 ? "\u00a3" + (valRight / 1000).toFixed(1) + "k" : "\u00a3" + Math.round(valRight);
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillStyle = "rgba(196,181,253, 0.8)";
      ctx.textAlign = "left";
      ctx.fillText(fmtR, w - pad.right + 12, y);
    }
  }

  // X-Axis
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  SHORT.forEach((label, i) => {
    const x = toX(i);
    const isCurrent = i === currentMonth;
    const isHover = i === hoverIndex;

    ctx.fillStyle = isCurrent ? "#c4b5fd" : isHover ? "#e2e8f0" : "#94a3b8";
    ctx.font = isCurrent ? "700 13px Inter, sans-serif" : isHover ? "600 12px Inter, sans-serif" : "500 12px Inter, sans-serif";
    ctx.fillText(label, x, h - pad.bottom + 12);

    // Tick
    ctx.beginPath();
    ctx.moveTo(x, pad.top + chartH);
    ctx.lineTo(x, pad.top + chartH + 6);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.stroke();
  });

  // Current Month Highlight
  const slotW = chartW / 12;
  ctx.fillStyle = "rgba(124, 58, 237, 0.04)";
  ctx.beginPath();
  ctx.roundRect(toX(currentMonth) - slotW / 2, pad.top, slotW, chartH, 6);
  ctx.fill();

  // Hover Highlight
  if (hoverIndex >= 0 && hoverIndex !== currentMonth) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.beginPath();
    ctx.roundRect(toX(hoverIndex) - slotW / 2, pad.top, slotW, chartH, 6);
    ctx.fill();
  }

  // ── Layer 1: Monthly Bars ──────────────────────────────────────────────────
  const barW = Math.min(slotW * 0.45, 28);

  for (let i = 0; i < 12; i++) {
    const x = toX(i);
    const bx = x - barW / 2;

    // Actual Fill
    if (actual[i] > 0) {
      const hActual = (actual[i] / maxMonthlyVisual) * chartH;
      const byA = pad.top + chartH - hActual;

      const barGrad = ctx.createLinearGradient(0, byA, 0, pad.top + chartH);
      barGrad.addColorStop(0, "rgba(6,182,212,0.85)");
      barGrad.addColorStop(1, "rgba(6,182,212,0.15)");

      ctx.fillStyle = barGrad;
      ctx.beginPath();
      ctx.roundRect(bx, byA, barW, hActual, [4, 4, 1, 1]);
      ctx.fill();

      // Top edge
      ctx.fillStyle = "rgba(34,211,238,0.9)";
      ctx.beginPath();
      ctx.rect(bx, byA, barW, 1);
      ctx.fill();
    }

    // Planned Outline
    if (planned[i] > 0) {
      const hPlanned = (planned[i] / maxMonthlyVisual) * chartH;
      const byP = pad.top + chartH - hPlanned;

      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(167,139,250,0.6)";
      ctx.lineWidth = 1.5;
      ctx.roundRect(bx, byP, barW, hPlanned, [4, 4, 1, 1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ── Layer 2: Cumulative Lines (Smoothed) ───────────────────────────────────
  function drawSmoothLine(data, colorStops, isDashed) {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      if (data[i] !== null) pts.push({ i, x: toX(i), y: toY_Right(data[i]), val: data[i] });
    }
    if (pts.length < 2) return;

    // 1. Fill Path (Area)
    const areaGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    areaGrad.addColorStop(0, isDashed ? "rgba(139,92,246,0.15)" : "rgba(6,182,212,0.15)");
    areaGrad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pad.top + chartH);
    ctx.lineTo(pts[0].x, pts[0].y);

    // Catmull-Rom Spline interpolation
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }

    ctx.lineTo(pts[pts.length - 1].x, pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // 2. Stroke Path
    const strokeGrad = ctx.createLinearGradient(pad.left, 0, w - pad.right, 0);
    colorStops.forEach((stop, idx) => strokeGrad.addColorStop(idx / (colorStops.length - 1), stop));

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }

    ctx.strokeStyle = strokeGrad;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (isDashed) ctx.setLineDash([6, 8]);

    ctx.shadowColor = isDashed ? "rgba(167,139,250,0.5)" : "rgba(6,182,212,0.5)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.setLineDash([]);

    // 3. Points
    pts.forEach((pt) => {
      const isHovered = pt.i === hoverIndex;
      const isLast = pt.i === pts.length - 1;

      if (isHovered || isLast) {
        ctx.beginPath();
        const radius = isHovered ? 6 : 4;
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#1e1e24";
        ctx.fill();

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = colorStops[1];
        ctx.stroke();

        if (isHovered) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
          ctx.fillStyle = isDashed ? "rgba(167,139,250,0.2)" : "rgba(6,182,212,0.2)";
          ctx.fill();
        }
      }
    });
  }

  drawSmoothLine(cumPlanned, ["#a78bfa", "#c4b5fd"], true);
  drawSmoothLine(cumActual, ["#06b6d4", "#22d3ee"], false);

  // ── Tooltip Interaction ────────────────────────────────────────────────────
  const tooltip = document.getElementById("chartTooltip");
  if (!tooltip) return;

  const onMouseMove = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvas.width / r.width / dpr);
    const slotW = chartW / 12;

    let idx = Math.floor((x - pad.left) / slotW);
    idx = Math.max(0, Math.min(11, idx));

    const centerX = toX(idx);
    const isNearby = Math.abs(x - centerX) < slotW / 1.5;

    if (!isNearby) {
      if (hoverIndex !== -1) renderProgressChart(-1);
      tooltip.classList.remove("visible");
      return;
    }

    if (idx !== hoverIndex) {
      renderProgressChart(idx);
    }

    const pMonth = planned[idx];
    const aMonth = actual[idx];
    const pCum = cumPlanned[idx];
    const aCum = cumActual[idx];
    const fmt = (v) => (v != null ? "\u00a3" + v.toLocaleString() : "—");

    tooltip.innerHTML = `
      <div class="chart-tooltip-month">${SHORT[idx]} ${state.progressYear}</div>
      <div class="chart-tooltip-row">
        <div class="chart-tooltip-dot" style="background:#a78bfa"></div>
        <div class="chart-tooltip-label">M. Plan</div>
        <div class="chart-tooltip-val">${fmt(pMonth)}</div>
      </div>
      <div class="chart-tooltip-row">
        <div class="chart-tooltip-dot" style="background:#06b6d4"></div>
        <div class="chart-tooltip-label">M. Actual</div>
        <div class="chart-tooltip-val">${fmt(aMonth)}</div>
      </div>
      <div style="height:1px; background:rgba(255,255,255,0.1); margin:8px 0;"></div>
      <div class="chart-tooltip-row">
        <div class="chart-tooltip-dot" style="background:#c4b5fd"></div>
        <div class="chart-tooltip-label">Total Plan</div>
        <div class="chart-tooltip-val">${fmt(pCum)}</div>
      </div>
      <div class="chart-tooltip-row">
        <div class="chart-tooltip-dot" style="background:#22d3ee"></div>
        <div class="chart-tooltip-label">Total Saved</div>
        <div class="chart-tooltip-val">${fmt(aCum)}</div>
      </div>
    `;

    const tipRect = tooltip.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const cursorX = e.clientX - containerRect.left;
    const cursorY = e.clientY - containerRect.top;

    let tx = cursorX + 20;
    let ty = cursorY + 20;
    if (tx + tipRect.width > containerRect.width) tx = cursorX - tipRect.width - 20;
    if (ty + tipRect.height > containerRect.height) ty = cursorY - tipRect.height - 20;

    tooltip.style.left = tx + "px";
    tooltip.style.top = ty + "px";
    tooltip.classList.add("visible");
  };

  const onMouseLeave = () => {
    if (hoverIndex !== -1) renderProgressChart(-1);
    tooltip.classList.remove("visible");
  };

  canvas.onmousemove = onMouseMove;
  canvas.onmouseleave = onMouseLeave;
}

function renderProgress() {
  const tbody = document.getElementById("progressTbody");
  const tfoot = document.getElementById("progressTfoot");
  const yearLabel = document.getElementById("progressYearLabel");
  if (!tbody) return;

  if (yearLabel) yearLabel.textContent = state.progressYear;

  const currentMonth = new Date().getMonth();
  let totalPlannedGary = 0, totalActualGary = 0;
  let totalPlannedCat = 0, totalActualCat = 0;

  // Short month names for mobile
  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  tbody.innerHTML = state.monthlyProgress
    .map((entry, idx) => {
      totalPlannedGary += entry.plannedGary;
      totalActualGary += entry.actualGary;
      totalPlannedCat += entry.plannedCat;
      totalActualCat += entry.actualCat;

      const rowTotalPlanned = entry.plannedGary + entry.plannedCat;
      const rowTotalActual = entry.actualGary + entry.actualCat;
      const diff = rowTotalActual - rowTotalPlanned;

      // Styling helpers
      const diffClass = diff > 0 ? "progress-diff positive" : diff < 0 ? "progress-diff negative" : "progress-diff";
      const diffLabel = diff > 0 ? `+${GBP.format(diff)}` : diff < 0 ? `\u2212${GBP.format(Math.abs(diff))}` : "\u2014";

      const isPast = idx < currentMonth;
      const isCurrent = idx === currentMonth;
      const isFuture = idx > currentMonth;
      const rowClass = isCurrent ? "progress-row progress-row--current" : isPast ? "progress-row progress-row--past" : "progress-row progress-row--future";

      return `
        <tr class="${rowClass}" data-month-index="${idx}">
          <td class="progress-month">
            <span class="month-full">${escapeHtml(entry.month)}</span>
            <span class="month-short">${SHORT_MONTHS[idx]}</span>
          </td>
          
          <!-- Gary -->
          <td><input data-field="plannedGary" class="number" type="number" min="0" step="50" value="${entry.plannedGary}" aria-label="Gary Planned ${entry.month}" placeholder="0" /></td>
          <td><input data-field="actualGary" class="number" type="number" min="0" step="50" value="${entry.actualGary}" aria-label="Gary Actual ${entry.month}" placeholder="0" /></td>
          
          <!-- Catherine -->
          <td><input data-field="plannedCat" class="number" type="number" min="0" step="50" value="${entry.plannedCat}" aria-label="Cat Planned ${entry.month}" placeholder="0" /></td>
          <td><input data-field="actualCat" class="number" type="number" min="0" step="50" value="${entry.actualCat}" aria-label="Cat Actual ${entry.month}" placeholder="0" /></td>

          <!-- Combined Diff -->
          <td class="${diffClass}" style="text-align:right; font-weight:600; font-size:0.85rem;">${diffLabel}</td>
          
          <!-- Notes -->
          <td><input data-field="notes" type="text" value="${escapeHtml(entry.notes)}" placeholder="${isFuture ? "Plan ahead\u2026" : "Notes\u2026"}" aria-label="Notes for ${entry.month}" /></td>
        </tr>`;
    })
    .join("");

  // Totals footer
  if (tfoot) {
    const totalPlannedAll = totalPlannedGary + totalPlannedCat;
    const totalActualAll = totalActualGary + totalActualCat;
    const totalDiff = totalActualAll - totalPlannedAll;

    const diffClass = totalDiff > 0 ? "progress-diff positive" : totalDiff < 0 ? "progress-diff negative" : "progress-diff";
    const diffLabel = totalDiff > 0 ? `+${GBP.format(totalDiff)}` : totalDiff < 0 ? `\u2212${GBP.format(Math.abs(totalDiff))}` : "\u2014";

    tfoot.innerHTML = `
      <tr class="progress-total-row">
        <td class="progress-month" style="padding-left:12px;">Total</td>
        <td class="number" style="color:var(--brand-light); opacity:0.8;">${GBP.format(totalPlannedGary)}</td>
        <td class="number" style="color:var(--brand-light);">${GBP.format(totalActualGary)}</td>
        <td class="number" style="color:var(--accent); opacity:0.8;">${GBP.format(totalPlannedCat)}</td>
        <td class="number" style="color:var(--accent);">${GBP.format(totalActualCat)}</td>
        <td class="${diffClass}" style="text-align:right;">${diffLabel}</td>
        <td></td>
      </tr>`;
  }

  // ── Summary stat cards ──────────────────────────────────────────────────
  const totalPlanned = totalPlannedGary + totalPlannedCat;
  const totalActual = totalActualGary + totalActualCat;

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText("progStatPlanned", GBP.format(totalPlanned));
  setText("progStatActual", GBP.format(totalActual));

  const pct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  setText("progStatPct", `${pct}% of target`);
  const meter = document.getElementById("progStatMeter");
  if (meter) meter.style.width = `${Math.min(100, pct)}%`;

  const totalDiff = totalActual - totalPlanned;
  const diffEl = document.getElementById("progStatDiff");
  const diffNote = document.getElementById("progStatDiffNote");
  const diffCard = document.getElementById("progStatDiffCard");
  if (diffEl) {
    if (totalDiff > 0) {
      diffEl.textContent = `+${GBP.format(totalDiff)}`;
      diffEl.className = "progress-stat-value progress-stat-value--positive";
    } else if (totalDiff < 0) {
      diffEl.textContent = `\u2212${GBP.format(Math.abs(totalDiff))}`;
      diffEl.className = "progress-stat-value progress-stat-value--negative";
    } else {
      diffEl.textContent = "\u2014";
      diffEl.className = "progress-stat-value";
    }
  }
  if (diffNote) {
    if (totalPlanned === 0) diffNote.textContent = "Set your targets first";
    else if (totalDiff >= 0) diffNote.textContent = "Ahead of schedule \ud83c\udf89";
    else diffNote.textContent = "Behind target \u2014 you've got this!";
  }
  if (diffCard) {
    diffCard.classList.toggle("progress-stat-card--positive", totalDiff > 0);
    diffCard.classList.toggle("progress-stat-card--negative", totalDiff < 0);
  }

  // ── Motivational message (using combined stats) ──────────────────────────
  const motEl = document.getElementById("progressMotivationText");
  const motEmoji = document.querySelector(".progress-motivation-emoji");
  const motBanner = document.getElementById("progressMotivation");
  if (motEl && motEmoji && motBanner) {
    const monthsSaved = state.monthlyProgress.filter((e, i) => i <= currentMonth && (e.actualGary + e.actualCat) > 0).length;
    const monthsPlanned = state.monthlyProgress.filter(e => (e.plannedGary + e.plannedCat) > 0).length;
    const monthsMissed = state.monthlyProgress.filter((e, i) => i < currentMonth && (e.plannedGary + e.plannedCat) > 0 && (e.actualGary + e.actualCat) < (e.plannedGary + e.plannedCat)).length;
    const monthsHit = state.monthlyProgress.filter((e, i) => i <= currentMonth && (e.plannedGary + e.plannedCat) > 0 && (e.actualGary + e.actualCat) >= (e.plannedGary + e.plannedCat)).length;

    let msg = "", emoji = "\ud83d\ude80";
    if (monthsPlanned === 0) {
      msg = "Start by entering your planned savings for each month \u2014 set the target, then crush it!";
      emoji = "\ud83d\ude80";
    } else if (monthsHit > 0 && monthsMissed === 0) {
      msg = `You've hit every single target so far! ${monthsHit} month${monthsHit !== 1 ? "s" : ""} of pure discipline. Keep the streak alive!`;
      emoji = "\ud83d\udd25";
    } else if (pct >= 100) {
      msg = "Incredible! You've already saved more than your total target for the year. You're built different.";
      emoji = "\ud83c\udfc6";
    } else if (pct >= 80) {
      msg = `${pct}% of your annual target saved. You're almost there \u2014 finish strong!`;
      emoji = "\ud83d\udcaa";
    } else if (monthsMissed > 0 && monthsMissed <= 2) {
      msg = `You missed ${monthsMissed} month${monthsMissed !== 1 ? "s" : ""}. Small slip, easy recovery. Every penny counts!`;
      emoji = "\ud83d\udca1";
    } else if (monthsMissed > 2) {
      msg = `${monthsMissed} months below target. Time to refocus \u2014 the gap is worth ${GBP.format(Math.abs(totalDiff))}. You can close it!`;
      emoji = "\u26a1";
    } else if (monthsSaved > 0) {
      msg = `${monthsSaved} month${monthsSaved !== 1 ? "s" : ""} tracked. Keep it up \u2014 consistency beats intensity!`;
      emoji = "\ud83d\udcc8";
    } else {
      msg = "A fresh start. Enter this month's savings and watch your progress grow!";
      emoji = "\u2728";
    }

    motEl.textContent = msg;
    motEmoji.textContent = emoji;
    motBanner.classList.toggle("progress-motivation--positive", totalDiff >= 0 && totalPlanned > 0);
    motBanner.classList.toggle("progress-motivation--negative", totalDiff < 0);
  }

  // ── Chart ────────────────────────────────────────────────────────────────
  renderProgressChart();
}

// ── Suggestions ────────────────────────────────────────────────────────────────

function generateSuggestions(derived) {
  const suggestions = [];
  const currentMonthIdx = new Date().getMonth();
  const currentEntry = state.monthlyProgress[currentMonthIdx];

  // 1. Unallocated funds — readyToAssign > 0 and there are goals to fund
  if (derived.readyToAssign > 0 && state.accounts.length > 0 && state.goals.length > 0 && derived.underFunded > 0) {
    suggestions.push({
      type: "action",
      icon: "⚡",
      title: "Unallocated Funds",
      text: `You have ${GBP.format(derived.readyToAssign)} sitting idle. Assign it to your goals now.`,
      cta: "Auto-assign",
      ctaAction: "auto-assign",
    });
  }

  // 2. Near-completion sub-goals (80–99% funded) — up to 3 shown
  let nearCount = 0;
  derived.subGoalsDerived.forEach((sg) => {
    if (nearCount >= 3) return;
    if (sg.target > 0 && sg.progress >= 80 && sg.progress < 100) {
      suggestions.push({
        type: "info",
        icon: "🎯",
        title: "Almost Funded",
        text: `Just ${GBP.format(sg.remaining)} more to fully fund "${escapeHtml(sg.name)}".`,
        cta: null,
        ctaAction: null,
      });
      nearCount++;
    }
  });

  // 3. Overfunded accounts — account has a large idle balance with nothing assigned from it
  if (state.goals.length > 0 && derived.underFunded > 0) {
    derived.accountsDerived.forEach((acct) => {
      if (acct.assigned === 0 && acct.balance >= 1000) {
        suggestions.push({
          type: "warning",
          icon: "💤",
          title: "Idle Account",
          text: `"${escapeHtml(acct.name)}" (${GBP.format(acct.balance)}) has no allocations — consider assigning some to your goals.`,
          cta: null,
          ctaAction: null,
        });
      }
    });
  }

  // 4. Behind on monthly savings for the current month
  if (currentEntry) {
    if (currentEntry.plannedGary > 0 && currentEntry.actualGary < currentEntry.plannedGary) {
      const gap = currentEntry.plannedGary - currentEntry.actualGary;
      suggestions.push({
        type: "warning",
        icon: "📉",
        title: "Gary Behind Plan",
        text: `Gary is ${GBP.format(gap)} behind his savings target for ${MONTHS[currentMonthIdx]}.`,
        cta: "View progress",
        ctaAction: "go-progress",
      });
    }
    if (currentEntry.plannedCat > 0 && currentEntry.actualCat < currentEntry.plannedCat) {
      const gap = currentEntry.plannedCat - currentEntry.actualCat;
      suggestions.push({
        type: "warning",
        icon: "📉",
        title: "Catherine Behind Plan",
        text: `Catherine is ${GBP.format(gap)} behind her savings target for ${MONTHS[currentMonthIdx]}.`,
        cta: "View progress",
        ctaAction: "go-progress",
      });
    }
  }

  // 5. No goals defined yet
  if (state.goals.length === 0) {
    suggestions.push({
      type: "action",
      icon: "🎯",
      title: "Set Your First Goal",
      text: "You haven't set any savings goals yet. Add one to start tracking what you're saving for.",
      cta: "Add goal",
      ctaAction: "add-goal",
    });
  }

  // 6. No accounts defined yet
  if (state.accounts.length === 0) {
    suggestions.push({
      type: "action",
      icon: "🏦",
      title: "Add Your Accounts",
      text: "No accounts found. Add your bank accounts to see your total funds and start planning.",
      cta: "Add account",
      ctaAction: "add-account",
    });
  }

  // 7. Goal fully funded — celebrate!
  derived.goalsDerived.forEach((goal) => {
    if (goal.progress === 100 && goal.target > 0) {
      suggestions.push({
        type: "success",
        icon: "🎉",
        title: `${escapeHtml(goal.name)} Complete!`,
        text: `You've fully funded "${escapeHtml(goal.name)}". Incredible work — what's next?`,
        cta: null,
        ctaAction: null,
      });
    }
  });

  // 8. Savings pace projection — based on the last 3 months of actuals
  if (currentMonthIdx >= 2) {
    const lookback = Math.min(3, currentMonthIdx);
    const recentMonths = state.monthlyProgress.slice(currentMonthIdx - lookback, currentMonthIdx);
    const hasActualData = recentMonths.some((m) => (m.actualGary + m.actualCat) > 0);
    const hasPlannedData = state.monthlyProgress.some((m) => (m.plannedGary + m.plannedCat) > 0);
    if (hasActualData && hasPlannedData) {
      const avgMonthly = recentMonths.reduce((sum, m) => sum + m.actualGary + m.actualCat, 0) / lookback;
      const monthsRemaining = 12 - currentMonthIdx;
      const savedSoFar = state.monthlyProgress.slice(0, currentMonthIdx).reduce((sum, m) => sum + m.actualGary + m.actualCat, 0);
      const projected = Math.round(savedSoFar + avgMonthly * monthsRemaining);
      const totalPlanned = state.monthlyProgress.reduce((sum, m) => sum + m.plannedGary + m.plannedCat, 0);
      if (totalPlanned > 0) {
        const projectedPct = Math.round((projected / totalPlanned) * 100);
        if (projectedPct >= 100) {
          suggestions.push({
            type: "success",
            icon: "🚀",
            title: "On Track for the Year",
            text: `At your current pace you'll save ${GBP.format(projected)} this year — that's ${projectedPct}% of your annual target!`,
            cta: null,
            ctaAction: null,
          });
        } else if (projectedPct < 80) {
          const shortfall = totalPlanned - projected;
          suggestions.push({
            type: "warning",
            icon: "⚠️",
            title: "Savings Pace Warning",
            text: `At your current pace you'll reach ${projectedPct}% of your annual target. You may fall ${GBP.format(shortfall)} short.`,
            cta: "View progress",
            ctaAction: "go-progress",
          });
        }
      }
    }
  }

  return suggestions;
}

function renderSuggestions(derived) {
  const panel = document.getElementById("suggestionsPanel");
  const strip = document.getElementById("suggestionsStrip");
  if (!panel || !strip) return;

  const suggestions = generateSuggestions(derived);

  if (suggestions.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  strip.innerHTML = suggestions.map((s) => {
    const ctaHtml = s.cta
      ? `<button class="suggestion-cta" data-suggestion-action="${escapeHtml(s.ctaAction)}" type="button">${escapeHtml(s.cta)}</button>`
      : "";
    return `
      <article class="suggestion-card suggestion-card--${escapeHtml(s.type)}" role="listitem">
        <div class="suggestion-card-top">
          <span class="suggestion-icon" aria-hidden="true">${s.icon}</span>
          <p class="suggestion-title">${s.title}</p>
        </div>
        <p class="suggestion-text">${s.text}</p>
        ${ctaHtml}
      </article>`;
  }).join("");
}

function renderApp() {
  sanitizeState();
  const derived = deriveState();
  updateSimpleMode();
  renderSummary(derived);
  renderAccounts(derived);
  renderSimpleAccounts(derived);
  renderGoals(derived);
  renderSimpleGoals(derived);
  renderAllocationForm(derived);
  renderAllocations(derived);
  renderProgress();
  renderSuggestions(derived);
  saveState();
}

// ── Allocation helpers ─────────────────────────────────────────────────────────

function addOrUpdateAllocation(accountId, subGoalId, amountToAdd) {
  const amount = normalizeAmount(amountToAdd);
  if (!amount) return;

  const existing = state.allocations.find(
    (allocation) => allocation.accountId === accountId && allocation.subGoalId === subGoalId,
  );

  if (existing) {
    existing.amount = normalizeAmount(existing.amount + amount);
    return;
  }

  state.allocations.push({ id: makeId("alloc"), accountId, subGoalId, amount });
}

function assignFunds(accountId, subGoalId, requestedAmount) {
  const amount = normalizeAmount(requestedAmount);
  if (!amount) {
    showToast("Invalid Amount", "Please enter a positive amount to assign.", "error");
    return;
  }

  const derived = deriveState();
  const account = derived.accountsDerived.find((item) => item.id === accountId);
  const subGoal = derived.subGoalsDerived.find((item) => item.id === subGoalId);

  if (!account || !subGoal) {
    showToast("Missing Selection", "Select both an account and a sub-goal.", "error");
    return;
  }

  if (account.available <= 0) {
    showToast("Insufficient Funds", "Selected account has no available cash.", "error");
    return;
  }

  if (subGoal.remaining <= 0) {
    showToast("Goal Funded", "That sub-goal is already fully funded!", "info");
    return;
  }

  const applied = Math.min(amount, account.available, subGoal.remaining);
  addOrUpdateAllocation(accountId, subGoalId, applied);
  renderApp();

  if (applied < amount) {
    showToast("Partial Allocation", `Assigned ${GBP.format(applied)} (capped by available funds).`, "info");
    return;
  }

  showToast("Funds Assigned", `allocated ${GBP.format(applied)} to ${subGoal.name}.`, "success");

  // If we just finished a goal, celebrate!
  if (subGoal.remaining - applied <= 0) {
    triggerConfetti();
  }
}

function autoAssignReadyCash() {
  const derived = deriveState();
  const openSubGoals = derived.subGoalsDerived.filter((subGoal) => subGoal.remaining > 0);
  const fundedAccounts = derived.accountsDerived.filter((account) => account.available > 0);

  if (!openSubGoals.length) {
    showToast("All Done!", "All sub-goals are fully funded.", "success");
    return;
  }

  if (!fundedAccounts.length) {
    showToast("No Funds", "No available cash to auto-assign.", "error");
    return;
  }

  const remainingBySubGoal = new Map(openSubGoals.map((subGoal) => [subGoal.id, subGoal.remaining]));
  let assignedTotal = 0;

  fundedAccounts.forEach((account) => {
    let accountAvailable = account.available;

    for (const subGoal of openSubGoals) {
      if (accountAvailable <= 0) break;

      const subGoalRemaining = remainingBySubGoal.get(subGoal.id) || 0;
      if (subGoalRemaining <= 0) continue;

      const allocation = Math.min(accountAvailable, subGoalRemaining);
      if (allocation <= 0) continue;

      addOrUpdateAllocation(account.id, subGoal.id, allocation);
      accountAvailable -= allocation;
      remainingBySubGoal.set(subGoal.id, subGoalRemaining - allocation);
      assignedTotal += allocation;
    }
  });

  renderApp();

  if (!assignedTotal) {
    showToast("Auto-Assign", "No valid allocation moves found.", "info");
    return;
  }

  showToast("Auto-Assign Complete", `Allocated ${GBP.format(assignedTotal)} across open goals.`, "success");
  triggerConfetti();
}

// ── Wire events ────────────────────────────────────────────────────────────────

function wireEvents() {
  const accountsTbody = document.getElementById("accountsTbody");
  const goalsBoard = document.getElementById("goalBoard");
  const allocationForm = document.getElementById("allocationForm");
  const allocationsTbody = document.getElementById("allocationsTbody");
  const addAccountBtn = document.getElementById("addAccountBtn");
  const addGoalBtn = document.getElementById("addGoalBtn");
  const autoAssignBtn = document.getElementById("autoAssignBtn");
  const resetDataBtn = document.getElementById("resetDataBtn");
  const resetDialog = document.getElementById("resetDialog");
  const resetCancelBtn = document.getElementById("resetCancelBtn");
  const resetConfirmBtn = document.getElementById("resetConfirmBtn");
  const progressTbody = document.getElementById("progressTbody");

  // ── Tab switching ─────────────────────────────────────────────────────────
  document.querySelector(".tab-bar")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    const tab = btn.getAttribute("data-tab");
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.getAttribute("data-tab-panel") === tab);
    });

    if (tab === "progress") {
      // Small delay to ensure layout is updated after display:block
      requestAnimationFrame(() => renderProgressChart());
    }
  });

  // ── Simple mode toggle ─────────────────────────────────────────────────────
  document.getElementById("simpleModeToggle")?.addEventListener("change", (e) => {
    simpleMode = e.target.checked;
    updateSimpleMode();
  });

  // ── Provider select — show/hide custom input ───────────────────────────────
  document.getElementById("newAcctProvider")?.addEventListener("change", (e) => {
    const customInput = document.getElementById("newAcctProviderCustom");
    if (!customInput) return;
    const isOther = e.target.value === "__other__";
    customInput.style.display = isOther ? "block" : "none";
    if (isOther) setTimeout(() => customInput.focus(), 30);
  });

  // ── Suggestions CTA buttons ──────────────────────────────────────────────
  document.getElementById("suggestionsStrip")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-suggestion-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-suggestion-action");
    if (action === "auto-assign") {
      autoAssignBtn?.click();
    } else if (action === "go-progress") {
      const progressTabBtn = document.querySelector(".tab-btn[data-tab='progress']");
      progressTabBtn?.click();
    } else if (action === "add-goal") {
      addGoalBtn?.click();
    } else if (action === "add-account") {
      addAccountBtn?.click();
    }
  });

  // ── Accounts table — inline editing ──────────────────────────────────────
  accountsTbody?.addEventListener("change", (e) => {
    const target = e.target;
    // Input or Select
    if (target.matches("input[data-field], select[data-field]")) {
      const row = target.closest("tr[data-account-id]");
      if (!row) return;

      const id = row.getAttribute("data-account-id");
      const field = target.getAttribute("data-field");
      const account = state.accounts.find((a) => a.id === id);

      if (account && field) {
        let val = target.value;
        if (field === "balance") val = normalizeAmount(val);
        if (field === "name" || field === "provider") val = val.trim();

        account[field] = val;
        renderApp();
        saveState();
      }
    }
  });

  // ── Progress table — inline editing ────────────────────────────────────────
  progressTbody?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const row = target.closest("tr[data-month-index]");
    if (!row) return;

    const idx = parseInt(row.getAttribute("data-month-index"), 10);
    const field = target.getAttribute("data-field");
    if (isNaN(idx) || !field || !state.monthlyProgress[idx]) return;

    if (field === "notes") {
      state.monthlyProgress[idx].notes = target.value;
    } else {
      // plannedGary, actualGary, plannedCat, actualCat
      state.monthlyProgress[idx][field] = normalizeAmount(target.value);
    }

    renderProgress();
    saveState();
  });

  // ── Add account wizard ────────────────────────────────────────────────────

  const addAccountWizard = document.getElementById("addAccountWizard");
  const addAccountProgress = document.getElementById("addAccountProgress");
  const addAccountStepLabel = document.getElementById("addAccountStepLabel");
  const addAccountNextBtn = document.getElementById("addAccountNextBtn");
  const addAccountBackBtn = document.getElementById("addAccountBackBtn");
  const addAccountCloseBtn = document.getElementById("addAccountCloseBtn");

  const acctSteps = [
    document.getElementById("addAcctStep1"), // Type
    document.getElementById("addAcctStep2"), // Name
    document.getElementById("addAcctStep3"), // Owner
    document.getElementById("addAcctStep4"), // Provider
    document.getElementById("addAcctStep5"), // Balance
  ];

  const acctStepLabels = [
    "Step 1 of 5 — Account type",
    "Step 2 of 5 — Nickname",
    "Step 3 of 5 — Owner",
    "Step 4 of 5 — Provider",
    "Step 5 of 5 — Balance",
  ];

  const acctProgressPct = ["20%", "40%", "60%", "80%", "100%"];

  let acctWizardStep = 0;
  let acctTypeSelected = "";
  let acctOwnerSelected = "";

  function resetAcctWizard() {
    acctWizardStep = 0;
    acctTypeSelected = "";
    acctOwnerSelected = "";
    document.getElementById("newAcctName").value = "";
    const provSel = document.getElementById("newAcctProvider");
    if (provSel) provSel.value = "";
    const provCustom = document.getElementById("newAcctProviderCustom");
    if (provCustom) { provCustom.value = ""; provCustom.style.display = "none"; }
    document.getElementById("newAcctBalance").value = "";
    document.querySelectorAll(".wizard-choice").forEach((btn) => btn.classList.remove("selected"));
    showAcctStep(0);
  }

  function showAcctStep(step) {
    acctSteps.forEach((el, i) => {
      if (el) el.hidden = i !== step;
    });
    if (addAccountStepLabel) addAccountStepLabel.textContent = acctStepLabels[step];
    if (addAccountProgress) addAccountProgress.style.width = acctProgressPct[step];
    if (addAccountBackBtn) addAccountBackBtn.style.visibility = step === 0 ? "hidden" : "visible";
    const isLast = step === acctSteps.length - 1;
    if (addAccountNextBtn) addAccountNextBtn.textContent = isLast ? "Add account ✓" : "Next →";
    // Auto-focus the visible input
    const visibleStep = acctSteps[step];
    if (visibleStep) {
      const input = visibleStep.querySelector("input");
      if (input) setTimeout(() => input.focus(), 60);
    }
  }

  addAccountBtn?.addEventListener("click", () => {
    resetAcctWizard();
    addAccountWizard?.showModal();
  });

  addAccountCloseBtn?.addEventListener("click", () => addAccountWizard?.close());
  addAccountWizard?.addEventListener("click", (e) => { if (e.target === addAccountWizard) addAccountWizard.close(); });

  // Type choice tiles
  document.getElementById("typeChoices")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".wizard-choice");
    if (!btn) return;
    document.querySelectorAll("#typeChoices .wizard-choice").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    acctTypeSelected = btn.getAttribute("data-value") || "";
    // Auto advance for type selection? Maybe better to let them confirm.
    // addAccountNextBtn?.click(); 
  });

  // Owner choice tiles
  document.getElementById("ownerChoices")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".wizard-choice");
    if (!btn) return;
    document.querySelectorAll("#ownerChoices .wizard-choice").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    acctOwnerSelected = btn.getAttribute("data-value") || "";
  });

  addAccountBackBtn?.addEventListener("click", () => {
    if (acctWizardStep > 0) {
      acctWizardStep--;
      showAcctStep(acctWizardStep);
    }
  });

  addAccountNextBtn?.addEventListener("click", () => {
    const nameInput = document.getElementById("newAcctName");

    // Step 1: Type
    if (acctWizardStep === 0) {
      if (!acctTypeSelected) {
        document.getElementById("typeChoices")?.querySelectorAll(".wizard-choice").forEach((b) => {
          b.style.borderColor = "var(--danger)";
          setTimeout(() => b.style.borderColor = "", 800);
        });
        return;
      }
    }

    // Step 2: Name
    if (acctWizardStep === 1) {
      if (!nameInput?.value.trim()) {
        nameInput?.classList.add("error");
        nameInput?.focus();
        return;
      }
      nameInput?.classList.remove("error");
    }

    // Step 3: Owner
    if (acctWizardStep === 2) {
      if (!acctOwnerSelected) {
        document.getElementById("ownerChoices")?.querySelectorAll(".wizard-choice").forEach((b) => {
          b.style.borderColor = "var(--danger)";
          setTimeout(() => b.style.borderColor = "", 800);
        });
        return;
      }
    }

    if (acctWizardStep < acctSteps.length - 1) {
      acctWizardStep++;
      showAcctStep(acctWizardStep);
      return;
    }

    // Final step — commit
    const type = acctTypeSelected || "Other";
    const name = nameInput?.value.trim() || "New Account";
    const owner = acctOwnerSelected || "Joint";
    // Resolve provider: if "Other / Custom" was selected, use the custom text input
    const providerSelect = document.getElementById("newAcctProvider");
    const providerCustom = document.getElementById("newAcctProviderCustom");
    const providerRaw = providerSelect?.value || "";
    const provider = providerRaw === "__other__"
      ? (providerCustom?.value || "").trim()
      : providerRaw.trim();
    const balance = normalizeAmount(document.getElementById("newAcctBalance")?.value || 0);

    state.accounts.push({ id: makeId("acct"), type, name, provider, owner, balance });
    renderApp();
    saveState(); // Ensure we save!
    addAccountWizard?.close();
  });

  // Allow Enter to advance the wizard on text/number steps
  addAccountWizard?.addEventListener("keydown", (e) => {
    // Block enter on choice steps (0 and 2) if not focused? 
    // Actually safe to just trigger click if they have valid input.
    if (e.key === "Enter") {
      e.preventDefault();
      addAccountNextBtn?.click();
    }
  });

  // ── Add goal wizard ────────────────────────────────────────────────────────

  const addGoalWizard = document.getElementById("addGoalWizard");
  const addGoalProgress = document.getElementById("addGoalProgress");
  const addGoalStepLabel = document.getElementById("addGoalStepLabel");
  const addGoalNextBtn = document.getElementById("addGoalNextBtn");
  const addGoalBackBtn = document.getElementById("addGoalBackBtn");
  const addGoalCloseBtn = document.getElementById("addGoalCloseBtn");

  const goalSteps = [
    document.getElementById("addGoalStep1"),
    document.getElementById("addGoalStep2"),
    document.getElementById("addGoalStep3"),
  ];

  const goalStepLabels = [
    "Step 1 of 3 — Goal name",
    "Step 2 of 3 — First sub-goal",
    "Step 3 of 3 — Target amount",
  ];

  const goalProgressPct = ["33%", "66%", "100%"];

  let goalWizardStep = 0;

  function resetGoalWizard() {
    goalWizardStep = 0;
    document.getElementById("newGoalName").value = "";
    document.getElementById("newSubGoalName").value = "";
    document.getElementById("newSubGoalTarget").value = "";
    showGoalStep(0);
  }

  function showGoalStep(step) {
    goalSteps.forEach((el, i) => {
      if (el) el.hidden = i !== step;
    });
    if (addGoalStepLabel) addGoalStepLabel.textContent = goalStepLabels[step];
    if (addGoalProgress) addGoalProgress.style.width = goalProgressPct[step];
    if (addGoalBackBtn) addGoalBackBtn.style.visibility = step === 0 ? "hidden" : "visible";
    const isLast = step === goalSteps.length - 1;
    if (addGoalNextBtn) addGoalNextBtn.textContent = isLast ? "Create goal ✓" : "Next →";
    const visibleStep = goalSteps[step];
    if (visibleStep) {
      const input = visibleStep.querySelector("input");
      if (input) setTimeout(() => input.focus(), 60);
    }
  }

  addGoalBtn?.addEventListener("click", () => {
    resetGoalWizard();
    addGoalWizard?.showModal();
  });

  addGoalCloseBtn?.addEventListener("click", () => addGoalWizard?.close());
  addGoalWizard?.addEventListener("click", (e) => { if (e.target === addGoalWizard) addGoalWizard.close(); });

  addGoalBackBtn?.addEventListener("click", () => {
    if (goalWizardStep > 0) {
      goalWizardStep--;
      showGoalStep(goalWizardStep);
    }
  });

  addGoalNextBtn?.addEventListener("click", () => {
    const goalNameInput = document.getElementById("newGoalName");
    const subGoalNameInput = document.getElementById("newSubGoalName");
    const subGoalTargetInput = document.getElementById("newSubGoalTarget");
    const preview = document.getElementById("newSubGoalNamePreview");

    if (goalWizardStep === 0) {
      if (!goalNameInput?.value.trim()) {
        goalNameInput?.classList.add("error");
        goalNameInput?.focus();
        return;
      }
      goalNameInput?.classList.remove("error");
    }

    if (goalWizardStep === 1) {
      if (!subGoalNameInput?.value.trim()) {
        subGoalNameInput?.classList.add("error");
        subGoalNameInput?.focus();
        return;
      }
      subGoalNameInput?.classList.remove("error");
      // Update the label preview on step 3
      if (preview) preview.textContent = subGoalNameInput.value.trim();
    }

    if (goalWizardStep < goalSteps.length - 1) {
      goalWizardStep++;
      showGoalStep(goalWizardStep);
      return;
    }

    // Final — commit
    const goalName = goalNameInput?.value.trim() || "New Goal";
    const subGoalName = subGoalNameInput?.value.trim() || "Sub-goal 1";
    const target = normalizeAmount(subGoalTargetInput?.value || 1000) || 1000;

    state.goals.push({
      id: makeId("goal"),
      name: goalName,
      subGoals: [{ id: makeId("sg"), name: subGoalName, target }],
    });
    renderApp();
    addGoalWizard?.close();
  });

  addGoalWizard?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addGoalNextBtn?.click();
    }
  });



  // ── Account edit toggle
  document.getElementById("acctEditBtn")?.addEventListener("click", () => {
    acctEditMode = !acctEditMode;
    const btn = document.getElementById("acctEditBtn");
    if (btn) btn.textContent = acctEditMode ? "✓ Done" : "✏ Edit";
    const derived = deriveState();
    renderAccounts(derived);
  });

  // ── Account filter bar
  document.getElementById("accountFilterBar")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-filter-owner]");
    if (!btn) return;
    const owner = btn.getAttribute("data-filter-owner");

    if (acctOwnerFilter.has(owner)) {
      if (acctOwnerFilter.size > 1) acctOwnerFilter.delete(owner);
    } else {
      acctOwnerFilter.add(owner);
    }
    const derived = deriveState();
    renderAccounts(derived);
  });

  // ── Auto-assign
  autoAssignBtn?.addEventListener("click", autoAssignReadyCash);

  // ── Reset dialog
  resetDataBtn?.addEventListener("click", () => {
    resetDialog?.showModal();
  });

  resetCancelBtn?.addEventListener("click", () => {
    resetDialog?.close();
  });

  resetConfirmBtn?.addEventListener("click", () => {
    state = structuredClone(DEFAULT_DATA);
    saveState();
    renderApp();
    resetDialog?.close();
    setAllocatorMessage("Data has been reset to defaults.", "success");
    showToast("Reset Complete", "All data has been restored to defaults.", "info");
  });

  resetDialog?.addEventListener("click", (event) => {
    if (event.target === resetDialog) resetDialog.close();
  });

  // ── Accounts table — input changes (name, provider, owner, balance)
  accountsTbody?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;

    const row = target.closest("tr[data-account-id]");
    if (!row) return;

    const accountId = row.getAttribute("data-account-id");
    const field = target.getAttribute("data-field");
    if (!accountId || !field) return;

    const account = state.accounts.find((entry) => entry.id === accountId);
    if (!account) return;

    if (field === "balance") {
      account.balance = normalizeAmount(target.value);
    } else {
      account[field] = target.value;
    }

    renderApp();
  });

  // ── Accounts table — remove
  accountsTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.getAttribute("data-action") !== "remove-account") return;

    const row = target.closest("tr[data-account-id]");
    const accountId = row?.getAttribute("data-account-id");
    if (!accountId) return;

    state.accounts = state.accounts.filter((account) => account.id !== accountId);
    state.allocations = state.allocations.filter((allocation) => allocation.accountId !== accountId);
    renderApp();
  });

  // ── Goals board — input changes
  goalsBoard?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const goalCard = target.closest("article[data-goal-id]");
    if (!goalCard) return;

    const goalId = goalCard.getAttribute("data-goal-id");
    const goal = state.goals.find((entry) => entry.id === goalId);
    if (!goal) return;

    const field = target.getAttribute("data-field");
    if (!field) return;

    if (field === "goal-name") {
      goal.name = target.value;
      renderApp();
      return;
    }

    const subGoalRow = target.closest("tr[data-subgoal-id]");
    const subGoalId = subGoalRow?.getAttribute("data-subgoal-id");
    if (!subGoalId) return;

    const subGoal = goal.subGoals.find((entry) => entry.id === subGoalId);
    if (!subGoal) return;

    if (field === "subgoal-target") subGoal.target = normalizeAmount(target.value);
    if (field === "subgoal-name") subGoal.name = target.value;

    renderApp();
  });

  // ── Goals board — button clicks
  goalsBoard?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const goalCard = target.closest("article[data-goal-id]");
    const goalId = goalCard?.getAttribute("data-goal-id");
    if (!goalId) return;

    const goal = state.goals.find((entry) => entry.id === goalId);
    if (!goal) return;

    const action = target.getAttribute("data-action");

    if (action === "edit-goal" || action === "save-goal") {
      toggleGoalEdit(goalId);
      return;
    }

    if (action === "remove-goal") {
      state.goals = state.goals.filter((entry) => entry.id !== goalId);
      const subGoalIds = new Set(goal.subGoals.map((subGoal) => subGoal.id));
      state.allocations = state.allocations.filter((allocation) => !subGoalIds.has(allocation.subGoalId));
      renderApp();
      return;
    }

    if (action === "add-subgoal") {
      goal.subGoals.push({
        id: makeId("sg"),
        name: `Sub-goal ${goal.subGoals.length + 1}`,
        target: 1000,
      });
      renderApp();
      return;
    }

    const subGoalRow = target.closest("tr[data-subgoal-id]");
    const subGoalId = subGoalRow?.getAttribute("data-subgoal-id");
    if (!subGoalId) return;

    if (action === "remove-subgoal") {
      goal.subGoals = goal.subGoals.filter((subGoal) => subGoal.id !== subGoalId);
      state.allocations = state.allocations.filter((allocation) => allocation.subGoalId !== subGoalId);
      renderApp();
      return;
    }

    if (action === "fill-subgoal") {
      const subGoalSelect = document.getElementById("allocationSubgoal");
      const amountInput = document.getElementById("allocationAmount");
      if (subGoalSelect) subGoalSelect.value = subGoalId;
      if (amountInput) amountInput.focus();
    }
  });

  // ── Allocation form — submit
  allocationForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const accountSelect = document.getElementById("allocationAccount");
    const subGoalSelect = document.getElementById("allocationSubgoal");
    const amountInput = document.getElementById("allocationAmount");

    if (!(accountSelect instanceof HTMLSelectElement)) return;
    if (!(subGoalSelect instanceof HTMLSelectElement)) return;
    if (!(amountInput instanceof HTMLInputElement)) return;

    assignFunds(accountSelect.value, subGoalSelect.value, amountInput.value);
    amountInput.value = "";
  });

  // ── Allocation ledger — edit amount
  allocationsTbody?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const row = target.closest("tr[data-allocation-id]");
    const allocationId = row?.getAttribute("data-allocation-id");
    if (!allocationId) return;

    const allocation = state.allocations.find((entry) => entry.id === allocationId);
    if (!allocation) return;

    allocation.amount = normalizeAmount(target.value);
    renderApp();
  });

  // ── Allocation ledger — remove
  allocationsTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.getAttribute("data-action") !== "remove-allocation") return;

    const row = target.closest("tr[data-allocation-id]");
    const allocationId = row?.getAttribute("data-allocation-id");
    if (!allocationId) return;

    state.allocations = state.allocations.filter((allocation) => allocation.id !== allocationId);
    renderApp();
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────

let cloudDataLoaded = false;

function initCloudSync() {
  if (!window.cloudSync || !window.cloudSync.isEnabled()) return;

  window.cloudSync.startCloudSync((cloudData) => {
    if (!cloudData) return;

    // Use a flag to prevent saveState() from pushing this back to cloud
    _skipCloudSync = true;
    state = cloudData;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    cloudDataLoaded = true;
    renderApp();
    _skipCloudSync = false;
  });
}

function bootstrap() {
  document.body.classList.add("entry-anim");
  setTimeout(() => document.body.classList.remove("entry-anim"), 1000);

  renderApp();
  wireEvents();

  // Connect to cloud sync — may already be ready or may arrive later
  if (window.cloudSync) {
    initCloudSync();
  } else {
    window.addEventListener("cloudSyncReady", () => initCloudSync(), { once: true });
  }

  // Redraw chart on resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderProgressChart, 150);
  });
}

bootstrap();
