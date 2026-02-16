const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const INITIAL_DATA = {
  accounts: [
    { id: "acct-alex-main", name: "Main Current", owner: "Alex", balance: 4200 },
    { id: "acct-jordan-save", name: "Savings Pot", owner: "Jordan", balance: 6800 },
    { id: "acct-joint-isa", name: "Joint Goal Saver", owner: "Joint", balance: 11800 },
  ],
  goals: [
    {
      id: "goal-house",
      name: "House",
      subGoals: [
        { id: "sg-house-deposit", name: "Deposit", target: 45000 },
        { id: "sg-house-solicitor", name: "Solicitor Fees", target: 3500 },
        { id: "sg-house-moving", name: "Moving Costs", target: 2800 },
      ],
    },
    {
      id: "goal-safety",
      name: "Emergency Buffer",
      subGoals: [
        { id: "sg-safety-income", name: "6-Month Income Cover", target: 12000 },
        { id: "sg-safety-home", name: "Home Repair Buffer", target: 2000 },
      ],
    },
  ],
  allocations: [
    { id: "alloc-1", accountId: "acct-joint-isa", subGoalId: "sg-house-deposit", amount: 9400 },
    { id: "alloc-2", accountId: "acct-jordan-save", subGoalId: "sg-house-solicitor", amount: 1200 },
    { id: "alloc-3", accountId: "acct-alex-main", subGoalId: "sg-house-moving", amount: 600 },
    { id: "alloc-4", accountId: "acct-joint-isa", subGoalId: "sg-safety-income", amount: 1800 },
  ],
};

let state = structuredClone(INITIAL_DATA);

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

function sanitizeState() {
  const accountIds = new Set();
  state.accounts = state.accounts.map((account, idx) => {
    const next = {
      ...account,
      id: account.id || makeId("acct"),
      name: String(account.name || `Account ${idx + 1}`).trim() || `Account ${idx + 1}`,
      owner: String(account.owner || "Joint").trim() || "Joint",
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
    return {
      ...account,
      assigned,
      available,
    };
  });

  const goalsDerived = state.goals.map((goal) => {
    const target = goal.subGoals.reduce((sum, subGoal) => sum + normalizeAmount(subGoal.target), 0);
    const assigned = goal.subGoals.reduce((sum, subGoal) => sum + (subGoalAssigned.get(subGoal.id) || 0), 0);
    const remaining = Math.max(0, target - assigned);
    const progress = target ? Math.min(100, Math.round((assigned / target) * 100)) : 0;

    return {
      ...goal,
      target,
      assigned,
      remaining,
      progress,
    };
  });

  const subGoalsDerived = subGoals.map((subGoal) => {
    const assigned = subGoalAssigned.get(subGoal.id) || 0;
    const target = normalizeAmount(subGoal.target);
    const remaining = Math.max(0, target - assigned);
    const progress = target ? Math.min(100, Math.round((assigned / target) * 100)) : 0;

    return {
      ...subGoal,
      target,
      assigned,
      remaining,
      progress,
    };
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

function setAllocatorMessage(text, type = "success") {
  const message = document.getElementById("allocatorMessage");
  if (!message) return;

  message.textContent = text;
  message.className = `allocator-message ${type}`;
}

function renderSummary(derived) {
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  setText("asOfDate", dateLabel());
  setText("totalFundsValue", GBP.format(derived.totalFunds));
  setText("readyToAssignValue", GBP.format(derived.readyToAssign));
  setText("totalAssignedValue", GBP.format(derived.totalAssigned));
  setText("underFundedValue", GBP.format(derived.underFunded));
  setText("overallProgressValue", `${derived.overallProgress}%`);

  const meter = document.getElementById("overallProgressBar");
  if (meter) {
    meter.style.width = `${derived.overallProgress}%`;
  }

  const ready = document.getElementById("readyToAssignValue");
  if (ready) {
    ready.classList.toggle("negative", derived.readyToAssign < 0);
  }
}

function renderAccounts(derived) {
  const tbody = document.getElementById("accountsTbody");
  if (!tbody) return;

  if (!derived.accountsDerived.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No accounts yet. Add one to start allocating funds.</td></tr>';
    return;
  }

  tbody.innerHTML = derived.accountsDerived
    .map((account) => {
      const availableClass = account.available < 0 ? "number negative" : "number";

      return `
        <tr data-account-id="${account.id}">
          <td><input data-field="name" value="${escapeHtml(account.name)}" aria-label="Account name" /></td>
          <td><input data-field="owner" value="${escapeHtml(account.owner)}" aria-label="Account owner" /></td>
          <td><input data-field="balance" class="number" type="number" min="0" step="50" value="${account.balance}" aria-label="Account balance" /></td>
          <td class="number">${GBP.format(account.assigned)}</td>
          <td class="${availableClass}">${GBP.format(account.available)}</td>
          <td><button type="button" class="row-remove" data-action="remove-account">Remove</button></td>
        </tr>
      `;
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
            `<option value="${account.id}">${escapeHtml(account.owner)} - ${escapeHtml(account.name)} (${GBP.format(
              account.available,
            )} available)</option>`,
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
            `<option value="${subGoal.id}">${escapeHtml(subGoal.goalName)} -> ${escapeHtml(subGoal.name)} (${GBP.format(
              subGoal.remaining,
            )} left)</option>`,
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
  if (submit) {
    submit.disabled = !canAssign;
  }
}

function renderAllocations(derived) {
  const tbody = document.getElementById("allocationsTbody");
  if (!tbody) return;

  if (!state.allocations.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No allocations yet. Assign money from an account to a sub-goal.</td></tr>';
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
          <td>${escapeHtml(account.owner)} - ${escapeHtml(account.name)}</td>
          <td>${escapeHtml(subGoal.goalName)} -> ${escapeHtml(subGoal.name)}</td>
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
                  <td>
                    <div class="progress-track" aria-hidden="true">
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
        <article class="goal-card" data-goal-id="${goal.id}">
          <div class="goal-header">
            <input class="goal-name-input" data-field="goal-name" value="${escapeHtml(goal.name)}" aria-label="Goal name" />
            <button type="button" class="row-remove" data-action="remove-goal">Remove goal</button>
          </div>

          <div class="goal-metrics">
            <span class="goal-chip">Target ${GBP.format(goal.target)}</span>
            <span class="goal-chip">Assigned ${GBP.format(goal.assigned)}</span>
            <span class="goal-chip">Remaining ${GBP.format(goal.remaining)}</span>
            <span class="goal-chip">Funded ${goal.progress}%</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sub-goal</th>
                  <th>Target</th>
                  <th>Assigned</th>
                  <th>Remaining</th>
                  <th>Progress</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          <div class="goal-footer">
            <button type="button" class="btn btn-secondary" data-action="add-subgoal">Add sub-goal</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderApp() {
  sanitizeState();
  const derived = deriveState();
  renderSummary(derived);
  renderAccounts(derived);
  renderGoals(derived);
  renderAllocationForm(derived);
  renderAllocations(derived);
}

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

  state.allocations.push({
    id: makeId("alloc"),
    accountId,
    subGoalId,
    amount,
  });
}

function assignFunds(accountId, subGoalId, requestedAmount) {
  const amount = normalizeAmount(requestedAmount);
  if (!amount) {
    setAllocatorMessage("Enter a positive amount to assign.", "warn");
    return;
  }

  const derived = deriveState();
  const account = derived.accountsDerived.find((item) => item.id === accountId);
  const subGoal = derived.subGoalsDerived.find((item) => item.id === subGoalId);

  if (!account || !subGoal) {
    setAllocatorMessage("Select both an account and a sub-goal.", "warn");
    return;
  }

  if (account.available <= 0) {
    setAllocatorMessage("Selected account has no available cash to assign.", "warn");
    return;
  }

  if (subGoal.remaining <= 0) {
    setAllocatorMessage("That sub-goal is already fully funded.", "warn");
    return;
  }

  const applied = Math.min(amount, account.available, subGoal.remaining);
  addOrUpdateAllocation(accountId, subGoalId, applied);
  renderApp();

  if (applied < amount) {
    setAllocatorMessage(`Assigned ${GBP.format(applied)} (capped by available cash or remaining target).`, "warn");
    return;
  }

  setAllocatorMessage(`Assigned ${GBP.format(applied)} to ${subGoal.goalName} -> ${subGoal.name}.`, "success");
}

function autoAssignReadyCash() {
  const derived = deriveState();
  const openSubGoals = derived.subGoalsDerived.filter((subGoal) => subGoal.remaining > 0);
  const fundedAccounts = derived.accountsDerived.filter((account) => account.available > 0);

  if (!openSubGoals.length) {
    setAllocatorMessage("All sub-goals are fully funded already.", "warn");
    return;
  }

  if (!fundedAccounts.length) {
    setAllocatorMessage("No available cash to auto-assign.", "warn");
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
    setAllocatorMessage("Auto-assign did not find any valid allocation moves.", "warn");
    return;
  }

  setAllocatorMessage(`Auto-assigned ${GBP.format(assignedTotal)} across open sub-goals.`, "success");
}

function wireEvents() {
  const accountsTbody = document.getElementById("accountsTbody");
  const goalsBoard = document.getElementById("goalBoard");
  const allocationForm = document.getElementById("allocationForm");
  const allocationsTbody = document.getElementById("allocationsTbody");
  const addAccountBtn = document.getElementById("addAccountBtn");
  const addGoalBtn = document.getElementById("addGoalBtn");
  const autoAssignBtn = document.getElementById("autoAssignBtn");

  addAccountBtn?.addEventListener("click", () => {
    state.accounts.push({
      id: makeId("acct"),
      name: "New Account",
      owner: "Joint",
      balance: 0,
    });
    renderApp();
  });

  addGoalBtn?.addEventListener("click", () => {
    state.goals.push({
      id: makeId("goal"),
      name: "New Goal",
      subGoals: [
        {
          id: makeId("sg"),
          name: "Sub-goal 1",
          target: 1000,
        },
      ],
    });
    renderApp();
  });

  autoAssignBtn?.addEventListener("click", autoAssignReadyCash);

  accountsTbody?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

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

  goalsBoard?.addEventListener("input", (event) => {
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

    if (field === "subgoal-target") {
      subGoal.target = normalizeAmount(target.value);
    }

    if (field === "subgoal-name") {
      subGoal.name = target.value;
    }

    renderApp();
  });

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

  allocationsTbody?.addEventListener("input", (event) => {
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

function bootstrap() {
  renderApp();
  wireEvents();
}

bootstrap();
