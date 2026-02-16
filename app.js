const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const SCENARIO_MULTIPLIER = {
  conservative: 0.85,
  base: 1,
  aggressive: 1.2,
};

function fetchCombinedFinanceData() {
  // TODO: Replace with real API fetch (bank feeds, budgeting app, or spreadsheet sync).
  // Wiring point: return this exact shape from your data layer for drop-in compatibility.
  return {
    asOf: "2026-02-16",
    trends: {
      months: ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"],
      householdBalance: [61200, 64800, 69300, 72550, 80100, 84250],
      goalsFundingPct: [22, 25, 27, 31, 35, 39],
    },
    monthlySavingsBase: 3150,
    monthlyEssentialsBase: 2100,
    goals: [
      {
        id: "house",
        name: "House Deposit",
        target: 80000,
        current: 24800,
        monthlyContribution: 1300,
      },
      {
        id: "holiday",
        name: "Holiday (Japan)",
        target: 9000,
        current: 3800,
        monthlyContribution: 450,
      },
      {
        id: "emergency",
        name: "Emergency Fund",
        target: 18000,
        current: 9700,
        monthlyContribution: 700,
      },
    ],
  };
}

function monthLabelFrom(date) {
  return date.toLocaleString("en-US", { month: "short" });
}

function addMonths(startDate, monthsToAdd) {
  const next = new Date(startDate);
  next.setMonth(next.getMonth() + monthsToAdd);
  return next;
}

function formatKpiValue(kpi) {
  if (kpi.unit === "%") return `${kpi.value}%`;
  if (kpi.unit === "months") return `${kpi.value.toFixed(1)} months`;
  return USD.format(kpi.value);
}

function toPolylinePoints(values, width, height, padding) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, idx) => {
      const x = padding + (idx * (width - padding * 2)) / (values.length - 1 || 1);
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function renderLineChart(containerId, labels, values, options) {
  const width = 640;
  const height = 240;
  const padding = 28;
  const points = toPolylinePoints(values, width, height, padding);
  const container = document.getElementById(containerId);

  const labelMarkup = labels
    .map((label, idx) => {
      const x = padding + (idx * (width - padding * 2)) / (labels.length - 1 || 1);
      return `<text x="${x}" y="226" text-anchor="middle" fill="#64748b" font-size="11">${label}</text>`;
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${containerId}-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${options.color}" stop-opacity="0.25" />
          <stop offset="100%" stop-color="${options.color}" stop-opacity="0.03" />
        </linearGradient>
      </defs>
      <polyline points="${points} ${(width - padding)},${height - padding} ${padding},${height - padding}"
        fill="url(#${containerId}-fill)" stroke="none" />
      <polyline points="${points}" fill="none" stroke="${options.color}" stroke-width="3" stroke-linecap="round" />
      ${labelMarkup}
    </svg>
  `;
}

function calculateEta(goal) {
  const gap = Math.max(goal.target - goal.current, 0);
  if (gap === 0) return "Funded";
  if (goal.monthlyContribution <= 0) return "No contribution";

  const months = Math.ceil(gap / goal.monthlyContribution);
  const etaDate = addMonths(new Date(), months);
  return `${monthLabelFrom(etaDate)} ${etaDate.getFullYear()}`;
}

function buildDerivedState(state) {
  const scenario = state.scenario;
  const savingsMultiplier = SCENARIO_MULTIPLIER[scenario] || 1;
  const monthlySavings = Math.round(state.seed.monthlySavingsBase * savingsMultiplier);

  const totalTarget = state.goals.reduce((sum, goal) => sum + goal.target, 0);
  const totalCurrent = state.goals.reduce((sum, goal) => sum + goal.current, 0);
  const goalsFundedPct = totalTarget ? Math.round((totalCurrent / totalTarget) * 100) : 0;

  const emergencyGoal = state.goals.find((goal) => goal.id === "emergency");
  const emergencyCoverage = emergencyGoal ? emergencyGoal.current / state.monthlyEssentials : 0;

  const baselineCurrent = state.seed.goals.reduce((sum, goal) => sum + goal.current, 0);
  const baseNetWorth = state.seed.trends.householdBalance[state.seed.trends.householdBalance.length - 1];
  const netWorth = baseNetWorth + (totalCurrent - baselineCurrent);

  const goalsContribution = state.goals.reduce((sum, goal) => sum + goal.monthlyContribution, 0);
  const projectionMonths = state.projectionMonths;
  const projectionLabels = [];
  const projectionBalance = [];
  const projectionFunding = [];

  let rollingBalance = netWorth;
  let rollingGoalPct = goalsFundedPct;

  for (let i = 1; i <= projectionMonths; i += 1) {
    const date = addMonths(new Date(), i);
    projectionLabels.push(monthLabelFrom(date));
    rollingBalance += monthlySavings;
    rollingGoalPct = Math.min(100, rollingGoalPct + Math.round((goalsContribution / totalTarget) * 100));
    projectionBalance.push(rollingBalance);
    projectionFunding.push(rollingGoalPct);
  }

  const balanceTrend = [...state.seed.trends.householdBalance, ...projectionBalance];
  const goalsTrend = [...state.seed.trends.goalsFundingPct, ...projectionFunding];
  const trendLabels = [...state.seed.trends.months, ...projectionLabels];

  const kpis = [
    { label: "Net Worth", value: netWorth, changePct: Math.round((monthlySavings / netWorth) * 1000) / 10 },
    { label: "Monthly Savings", value: monthlySavings, changePct: Math.round((savingsMultiplier - 1) * 100) },
    { label: "Emergency Fund Coverage", value: emergencyCoverage, unit: "months", changePct: 0 },
    { label: "Goals Funded", value: goalsFundedPct, unit: "%", changePct: Math.max(goalsFundedPct - state.seed.trends.goalsFundingPct[state.seed.trends.goalsFundingPct.length - 1], 0) },
  ];

  return { kpis, trendLabels, balanceTrend, goalsTrend };
}

function renderKpis(kpis) {
  const grid = document.getElementById("kpiGrid");
  grid.innerHTML = kpis
    .map((kpi) => {
      const directionClass = kpi.changePct >= 0 ? "up" : "down";
      const sign = kpi.changePct >= 0 ? "+" : "";
      return `
        <article class="kpi-card">
          <p class="kpi-label">${kpi.label}</p>
          <p class="kpi-value">${formatKpiValue(kpi)}</p>
          <p class="kpi-change ${directionClass}">${sign}${kpi.changePct}% vs reference</p>
        </article>
      `;
    })
    .join("");
}

function renderGoals(goals) {
  const tbody = document.getElementById("goalRows");
  tbody.innerHTML = goals
    .map((goal) => {
      const pct = goal.target ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
      return `
      <tr data-goal-id="${goal.id}">
        <td>${goal.name}</td>
        <td><input aria-label="${goal.name} target" data-field="target" type="number" min="0" step="100" value="${goal.target}" /></td>
        <td><input aria-label="${goal.name} current" data-field="current" type="number" min="0" step="100" value="${goal.current}" /></td>
        <td>
          <div class="progress-track" aria-label="${goal.name} progress">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          ${pct}%
        </td>
        <td><input aria-label="${goal.name} contribution" data-field="monthlyContribution" type="number" min="0" step="50" value="${goal.monthlyContribution}" /></td>
        <td>${calculateEta(goal)}</td>
      </tr>
    `;
    })
    .join("");
}

function setupBindings(state, rerender) {
  const scenarioSelect = document.getElementById("scenarioSelect");
  const projectionMonths = document.getElementById("projectionMonths");
  const monthlyEssentials = document.getElementById("monthlyEssentials");
  const resetBtn = document.getElementById("resetBtn");
  const goalRows = document.getElementById("goalRows");

  scenarioSelect.addEventListener("change", (event) => {
    state.scenario = event.target.value;
    rerender();
  });

  projectionMonths.addEventListener("change", (event) => {
    state.projectionMonths = Number(event.target.value);
    rerender();
  });

  monthlyEssentials.addEventListener("input", (event) => {
    const parsed = Number(event.target.value);
    state.monthlyEssentials = parsed > 0 ? parsed : state.seed.monthlyEssentialsBase;
    rerender();
  });

  goalRows.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const row = target.closest("tr[data-goal-id]");
    if (!row) return;

    const goal = state.goals.find((item) => item.id === row.getAttribute("data-goal-id"));
    if (!goal) return;

    const field = target.getAttribute("data-field");
    if (!field) return;

    const parsed = Math.max(0, Number(target.value) || 0);
    goal[field] = parsed;
    rerender();
  });

  resetBtn.addEventListener("click", () => {
    state.scenario = "base";
    state.projectionMonths = 6;
    state.monthlyEssentials = state.seed.monthlyEssentialsBase;
    state.goals = state.seed.goals.map((goal) => ({ ...goal }));

    scenarioSelect.value = "base";
    projectionMonths.value = "6";
    monthlyEssentials.value = String(state.seed.monthlyEssentialsBase);
    rerender();
  });
}

function renderDashboard(state) {
  document.getElementById("asOfDate").textContent = `As of ${state.seed.asOf}`;
  const derived = buildDerivedState(state);

  renderKpis(derived.kpis);
  renderLineChart("balanceTrend", derived.trendLabels, derived.balanceTrend, { color: "#1d4ed8" });
  renderLineChart("goalsTrend", derived.trendLabels, derived.goalsTrend, { color: "#0f766e" });
  renderGoals(state.goals);
}

function bootstrap() {
  const seed = fetchCombinedFinanceData();
  const state = {
    seed,
    goals: seed.goals.map((goal) => ({ ...goal })),
    scenario: "base",
    projectionMonths: 6,
    monthlyEssentials: seed.monthlyEssentialsBase,
  };

  const rerender = () => renderDashboard(state);
  renderDashboard(state);
  setupBindings(state, rerender);
}

bootstrap();
