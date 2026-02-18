const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const STORAGE_KEY = "gcfinance-v1";

const OWNERS = ["Gary", "Catherine", "Joint"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DEFAULT_DATA = {
  accounts: [
    { id: "acct-gary-current", name: "Current Account", provider: "Monzo", owner: "Gary", balance: 0 },
    { id: "acct-gary-savings", name: "Savings", provider: "Monzo", owner: "Gary", balance: 0 },
    { id: "acct-cat-current", name: "Current Account", provider: "Barclays", owner: "Catherine", balance: 0 },
    { id: "acct-cat-savings", name: "Savings", provider: "Barclays", owner: "Catherine", balance: 0 },
    { id: "acct-joint-isa", name: "Joint ISA", provider: "Nationwide", owner: "Joint", balance: 0 },
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

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors (private mode etc.)
  }
}

let state = loadState();

// ── UI state (not persisted) ───────────────────────────────────────────────────
let acctOwnerFilter = new Set(OWNERS); // which owners to show; all active by default
let acctEditMode = false;              // whether the accounts table is in edit mode

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


function sanitizeState() {
  const accountIds = new Set();
  state.accounts = state.accounts.map((account, idx) => {
    const next = {
      ...account,
      id: account.id || makeId("acct"),
      name: String(account.name || `Account ${idx + 1}`).trim() || `Account ${idx + 1}`,
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
      `<button type="button" class="filter-pill${allActive ? " active" : ""}" data-filter-owner="all">All</button>` +
      OWNERS.map((o) => {
        const active = acctOwnerFilter.has(o);
        return `<button type="button" class="filter-pill filter-pill--${OWNER_COLORS[o] || "other"}${active ? " active" : ""}" data-filter-owner="${escapeHtml(o)}">${escapeHtml(o)}</button>`;
      }).join("");
  }

  if (!derived.accountsDerived.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No accounts yet. Add one to start allocating funds.</td></tr>';
    return;
  }

  // ── Filter by active owners ───────────────────────────────────────────────
  const visible = derived.accountsDerived.filter((a) => acctOwnerFilter.has(a.owner));

  if (!visible.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No accounts match the current filter.</td></tr>';
    return;
  }

  // ── Group by account name (type), sorted alphabetically ──────────────────
  const typeMap = new Map();
  visible.forEach((account) => {
    const key = account.name.trim();
    if (!typeMap.has(key)) typeMap.set(key, []);
    typeMap.get(key).push(account);
  });

  const sortedTypes = [...typeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  tbody.innerHTML = sortedTypes
    .map(([typeName, accounts]) => {
      const groupHeader = `
        <tr class="account-group-header">
          <td colspan="6"><span class="account-group-label account-group-label--type">${escapeHtml(typeName)}</span></td>
        </tr>`;

      const rows = accounts
        .map((account) => {
          const availableClass = account.available < 0 ? "number negative" : "number";
          const ownerKey = OWNER_COLORS[account.owner] || "other";

          const ownerCell = acctEditMode
            ? `<select data-field="owner" class="owner-pill owner-pill--${ownerKey}" aria-label="Account owner">${OWNERS.map(
              (o) => `<option value="${o}"${o === account.owner ? " selected" : ""}>${escapeHtml(o)}</option>`
            ).join("")}</select>`
            : `<span class="owner-pill-label owner-pill-label--${ownerKey}">${escapeHtml(account.owner)}</span>`;

          const providerCell = acctEditMode
            ? `<input data-field="provider" value="${escapeHtml(account.provider || "")}" aria-label="Provider" />`
            : `<span class="acct-text">${escapeHtml(account.provider || "—")}</span>`;

          const removeCell = acctEditMode
            ? `<button type="button" class="row-remove" data-action="remove-account">Remove</button>`
            : ``;

          return `
            <tr data-account-id="${account.id}">
              <td>${ownerCell}</td>
              <td>${providerCell}</td>
              <td><input data-field="balance" class="number" type="number" min="0" step="50" value="${account.balance}" aria-label="Account balance" /></td>
              <td class="number">${GBP.format(account.assigned)}</td>
              <td class="${availableClass}">${GBP.format(account.available)}</td>
              <td>${removeCell}</td>
            </tr>`;
        })
        .join("");

      return groupHeader + rows;
    })
    .join("");
}

function renderAllocationForm(derived) {
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

function renderAllocations(derived) {
  const tbody = document.getElementById("allocationsTbody");
  if (!tbody) return;

  if (!state.allocations.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="4">No allocations yet. Assign money from an account to a sub-goal.</td></tr>';
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
      const rows = goal.subGoals.length
        ? goal.subGoals
          .map((subGoal) => {
            const derivedSubGoal = derived.subGoalsDerived.find((item) => item.id === subGoal.id);
            if (!derivedSubGoal) return "";

            return `
                <tr data-goal-id="${goal.id}" data-subgoal-id="${subGoal.id}">
                  <td><input data-field="subgoal-name" value="${escapeHtml(subGoal.name)}" aria-label="Sub-goal name" /></td>
                  <td><input data-field="subgoal-target" class="number" type="number" min="0" step="100" value="${derivedSubGoal.target}" aria-label="Sub-goal target" /></td>
                  <td class="number">${GBP.format(derivedSubGoal.assigned)}</td>
                  <td class="number">${GBP.format(derivedSubGoal.remaining)}</td>
                  <td style="width: 120px;">
                    <div class="progress-track" aria-label="${derivedSubGoal.progress}% complete">
                      <div class="progress-fill" style="width:${derivedSubGoal.progress}%"></div>
                    </div>
                  </td>

                  <td>
                    <div class="subgoal-actions">
                      <button type="button" class="action-ghost" data-action="fill-subgoal">Assign</button>
                      <button type="button" class="row-remove" data-action="remove-subgoal">Remove</button>
                    </div>
                  </td>
                </tr>
              `;
          })
          .join("")
        : '<tr class="empty-row"><td colspan="6">No sub-goals yet for this goal.</td></tr>';

      return `
        <article class="goal-card" data-goal-id="${goal.id}" data-complete="${goal.progress >= 100}">
          <div class="goal-header">
            <input class="goal-name-input" data-field="goal-name" value="${escapeHtml(goal.name)}" aria-label="Goal name" />
            <button type="button" class="btn-danger-soft" style="margin-top:0" data-action="remove-goal">Remove</button>
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

          <div class="goal-footer" style="margin-top: 20px; display: flex; justify-content: flex-end;">
            <button type="button" class="btn btn-secondary" data-action="add-subgoal">+ Add sub-goal</button>
          </div>
        </article>

      `;
    })
    .join("");
}

// ── Charts ─────────────────────────────────────────────────────────────────────

function setupCanvas(canvas, desiredHeight) {
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0) return null; // hidden tab
  canvas.width = rect.width * dpr;
  canvas.height = desiredHeight * dpr;
  canvas.style.width = rect.width + "px";
  canvas.style.height = desiredHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, desiredHeight);
  return { ctx, w: rect.width, h: desiredHeight };
}

function renderMonthlyBarChart() {
  const canvas = document.getElementById("monthlyBarChart");
  if (!canvas) return;
  const setup = setupCanvas(canvas, 280);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const pad = { top: 24, right: 20, bottom: 40, left: 56 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const planned = state.monthlyProgress.map((e) => (e.plannedGary || 0) + (e.plannedCat || 0));
  const actual = state.monthlyProgress.map((e) => (e.actualGary || 0) + (e.actualCat || 0));
  const maxVal = Math.max(1, ...planned, ...actual) * 1.15;
  const currentMonth = new Date().getMonth();

  const slotW = chartW / 12;
  const barW = Math.min(slotW * 0.32, 28);
  const gap = Math.max(2, barW * 0.15);
  const toX = (i) => pad.left + slotW * i + slotW / 2;
  const toY = (v) => pad.top + chartH - (v / maxVal) * chartH;

  // Grid lines & Left Y-axis labels
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "600 10px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const gridCount = 5;
  for (let i = 0; i <= gridCount; i++) {
    const val = Math.round((maxVal / gridCount) * i);
    const y = toY(val);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    if (i > 0) ctx.fillText("£" + val.toLocaleString(), pad.left - 8, y);
  }

  // X-axis labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  SHORT.forEach((label, i) => {
    const x = toX(i);
    const isCurrent = i === currentMonth;
    ctx.fillStyle = isCurrent ? "#a78bfa" : "#64748b";
    ctx.font = isCurrent ? "700 11px Inter, sans-serif" : "600 11px Inter, sans-serif";
    ctx.fillText(label, x, h - pad.bottom + 8);
  });

  // Current month subtle highlight
  ctx.fillStyle = "rgba(124, 58, 237, 0.04)";
  ctx.beginPath();
  ctx.roundRect(toX(currentMonth) - slotW / 2, pad.top, slotW, chartH, 4);
  ctx.fill();

  // Draw bars
  const baseline = pad.top + chartH;

  for (let i = 0; i < 12; i++) {
    const x = toX(i);
    const isFuture = i > currentMonth;

    // Planned bar (left)
    const pHeight = (planned[i] / maxVal) * chartH;
    if (planned[i] > 0) {
      const bx = x - gap / 2 - barW;
      const by = baseline - pHeight;
      const grad = ctx.createLinearGradient(0, by, 0, baseline);
      grad.addColorStop(0, isFuture ? "rgba(167,139,250,0.25)" : "rgba(167,139,250,0.6)");
      grad.addColorStop(1, isFuture ? "rgba(167,139,250,0.08)" : "rgba(167,139,250,0.15)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, pHeight, [4, 4, 0, 0]);
      ctx.fill();
      ctx.fillStyle = isFuture ? "rgba(167,139,250,0.3)" : "#a78bfa";
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, 3, [4, 4, 0, 0]);
      ctx.fill();
    }

    // Actual bar (right)
    const aHeight = (actual[i] / maxVal) * chartH;
    if (actual[i] > 0) {
      const bx = x + gap / 2;
      const by = baseline - aHeight;
      const grad = ctx.createLinearGradient(0, by, 0, baseline);
      grad.addColorStop(0, "rgba(6,182,212,0.7)");
      grad.addColorStop(1, "rgba(6,182,212,0.15)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, aHeight, [4, 4, 0, 0]);
      ctx.fill();
      ctx.fillStyle = "#06b6d4";
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, 3, [4, 4, 0, 0]);
      ctx.fill();
    }

    // Value labels on top of bars
    ctx.font = "600 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    if (planned[i] > 0 && pHeight > 18) {
      ctx.fillStyle = isFuture ? "rgba(167,139,250,0.5)" : "#c4b5fd";
      ctx.fillText("£" + planned[i].toLocaleString(), x - gap / 2 - barW / 2, baseline - pHeight - 4);
    }
    if (actual[i] > 0 && aHeight > 18) {
      ctx.fillStyle = "#22d3ee";
      ctx.fillText("£" + actual[i].toLocaleString(), x + gap / 2 + barW / 2, baseline - aHeight - 4);
    }
  }
}

function renderCumulativeChart() {
  const canvas = document.getElementById("cumulativeChart");
  if (!canvas) return;
  const setup = setupCanvas(canvas, 280);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const pad = { top: 24, right: 20, bottom: 40, left: 56 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const planned = state.monthlyProgress.map((e) => (e.plannedGary || 0) + (e.plannedCat || 0));
  const actual = state.monthlyProgress.map((e) => (e.actualGary || 0) + (e.actualCat || 0));
  const currentMonth = new Date().getMonth();

  // Build cumulative arrays
  let cumP = 0, cumA = 0;
  const cumPlanned = [];
  const cumActual = [];
  for (let i = 0; i < 12; i++) {
    cumP += planned[i];
    cumA += actual[i];
    cumPlanned.push(cumP);
    if (i <= currentMonth || actual[i] > 0) {
      cumActual.push(cumA);
    } else {
      cumActual.push(null);
    }
  }

  const maxVal = Math.max(1, cumP, cumA) * 1.1;
  const xStep = chartW / 11;
  const toX = (i) => pad.left + i * xStep;
  const toY = (v) => pad.top + chartH - (v / maxVal) * chartH;

  // Grid lines & Y-axis labels
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "600 10px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const gridCount = 5;
  for (let i = 0; i <= gridCount; i++) {
    const val = Math.round((maxVal / gridCount) * i);
    const y = toY(val);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    if (i > 0) ctx.fillText("£" + val.toLocaleString(), pad.left - 8, y);
  }

  // X-axis labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  SHORT.forEach((label, i) => {
    const x = toX(i);
    const isCurrent = i === currentMonth;
    ctx.fillStyle = isCurrent ? "#a78bfa" : "#64748b";
    ctx.font = isCurrent ? "700 11px Inter, sans-serif" : "600 11px Inter, sans-serif";
    ctx.fillText(label, x, h - pad.bottom + 8);
  });

  // Current month vertical guide
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(167,139,250,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(toX(currentMonth), pad.top);
  ctx.lineTo(toX(currentMonth), pad.top + chartH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Helper: Draw filled area line
  function drawAreaLine(data, lineColor, fillColor, glowColor) {
    const points = [];
    for (let i = 0; i < 12; i++) {
      if (data[i] !== null) points.push({ i, x: toX(i), y: toY(data[i]), val: data[i] });
    }
    if (points.length < 2) return;

    // Area fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, fillColor);
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.top + chartH);
    ctx.lineTo(points[0].x, points[0].y);
    for (let p = 1; p < points.length; p++) {
      const prev = points[p - 1];
      const curr = points[p];
      const cpx = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let p = 1; p < points.length; p++) {
      const prev = points[p - 1];
      const curr = points[p];
      const cpx = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.stroke();

    // Glow line (underneath)
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 8;
    ctx.filter = "blur(4px)";
    ctx.stroke();
    ctx.restore();

    // Dots at every data point & value labels at milestones
    ctx.font = "700 10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    points.forEach((pt, idx) => {
      const isLast = idx === points.length - 1;
      const isFirst = idx === 0;
      const isMilestone = isFirst || isLast || pt.i === currentMonth;

      // Dot
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isMilestone ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      if (isMilestone) {
        // Outer glow
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();

        // Value label
        ctx.fillStyle = lineColor;
        ctx.fillText("£" + pt.val.toLocaleString(), pt.x, pt.y - 12);
      }
    });
  }

  // Draw Planned total (purple, behind)
  drawAreaLine(cumPlanned, "#a78bfa", "rgba(167,139,250,0.08)", "rgba(167,139,250,0.25)");

  // Draw Actual total (cyan, on top)
  drawAreaLine(cumActual, "#06b6d4", "rgba(6,182,212,0.12)", "rgba(6,182,212,0.3)");
}

function renderProgressChart() {
  renderMonthlyBarChart();
  renderCumulativeChart();
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

function renderApp() {
  sanitizeState();
  const derived = deriveState();
  renderSummary(derived);
  renderAccounts(derived);
  renderGoals(derived);
  renderAllocationForm(derived);
  renderAllocations(derived);
  renderProgress();
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
    document.getElementById("addAcctStep1"),
    document.getElementById("addAcctStep2"),
    document.getElementById("addAcctStep3"),
    document.getElementById("addAcctStep4"),
  ];

  const acctStepLabels = [
    "Step 1 of 4 — Account name",
    "Step 2 of 4 — Owner",
    "Step 3 of 4 — Provider",
    "Step 4 of 4 — Balance",
  ];

  const acctProgressPct = ["25%", "50%", "75%", "100%"];

  let acctWizardStep = 0;
  let acctOwnerSelected = "";

  function resetAcctWizard() {
    acctWizardStep = 0;
    acctOwnerSelected = "";
    document.getElementById("newAcctName").value = "";
    document.getElementById("newAcctProvider").value = "";
    document.getElementById("newAcctBalance").value = "";
    document.querySelectorAll("#ownerChoices .wizard-choice").forEach((btn) => btn.classList.remove("selected"));
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

    // Validate current step
    if (acctWizardStep === 0) {
      if (!nameInput?.value.trim()) {
        nameInput?.classList.add("error");
        nameInput?.focus();
        return;
      }
      nameInput?.classList.remove("error");
    }

    if (acctWizardStep === 1) {
      if (!acctOwnerSelected) {
        // Highlight choices area to nudge the user
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
    const name = nameInput?.value.trim() || "New Account";
    const owner = acctOwnerSelected || "Joint";
    const provider = (document.getElementById("newAcctProvider")?.value || "").trim();
    const balance = normalizeAmount(document.getElementById("newAcctBalance")?.value || 0);

    state.accounts.push({ id: makeId("acct"), name, provider, owner, balance });
    renderApp();
    addAccountWizard?.close();
  });

  // Allow Enter to advance the wizard on text/number steps
  addAccountWizard?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && acctWizardStep !== 1) {
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
    if (owner === "all") {
      acctOwnerFilter = new Set(OWNERS);
    } else {
      if (acctOwnerFilter.has(owner)) {
        if (acctOwnerFilter.size > 1) acctOwnerFilter.delete(owner);
      } else {
        acctOwnerFilter.add(owner);
      }
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

function bootstrap() {
  renderApp();
  wireEvents();
  // Redraw chart on resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderProgressChart, 150);
  });
}

bootstrap();
