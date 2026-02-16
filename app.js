const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fetchCombinedFinanceData() {
  // TODO: Replace with real API fetch (bank feeds, budgeting app, or spreadsheet sync).
  // Wiring point: return this exact shape from your data layer for drop-in compatibility.
  return {
    asOf: "2026-02-16",
    kpis: [
      { label: "Net Worth", value: 84250, changePct: 2.8 },
      { label: "Monthly Savings", value: 3150, changePct: 4.2 },
      { label: "Emergency Fund Coverage", value: 4.6, unit: "months", changePct: 0.2 },
      { label: "Goals Funded", value: 39, unit: "%", changePct: 1.4 },
    ],
    trends: {
      months: ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"],
      householdBalance: [61200, 64800, 69300, 72550, 80100, 84250],
      goalsFundingPct: [22, 25, 27, 31, 35, 39],
    },
    goals: [
      {
        id: "house",
        name: "House Deposit",
        target: 80000,
        current: 24800,
        monthlyContribution: 1300,
        eta: "Apr 2029",
      },
      {
        id: "holiday",
        name: "Holiday (Japan)",
        target: 9000,
        current: 3800,
        monthlyContribution: 450,
        eta: "Jun 2027",
      },
      {
        id: "emergency",
        name: "Emergency Fund",
        target: 18000,
        current: 9700,
        monthlyContribution: 700,
        eta: "Oct 2026",
      },
    ],
  };
}

function formatKpiValue(kpi) {
  if (kpi.unit === "%") return `${kpi.value}%`;
  if (kpi.unit === "months") return `${kpi.value.toFixed(1)} months`;
  return USD.format(kpi.value);
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
          <p class="kpi-change ${directionClass}">${sign}${kpi.changePct}% vs last month</p>
        </article>
      `;
    })
    .join("");
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

function renderGoals(goals) {
  const tbody = document.getElementById("goalRows");
  tbody.innerHTML = goals
    .map((goal) => {
      const pct = Math.min(100, Math.round((goal.current / goal.target) * 100));
      return `
      <tr>
        <td>${goal.name}</td>
        <td>${USD.format(goal.target)}</td>
        <td>${USD.format(goal.current)}</td>
        <td>
          <div class="progress-track" aria-label="${goal.name} progress">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          ${pct}%
        </td>
        <td>${USD.format(goal.monthlyContribution)}</td>
        <td>${goal.eta}</td>
      </tr>
    `;
    })
    .join("");
}

function renderDashboard() {
  const data = fetchCombinedFinanceData();
  document.getElementById("asOfDate").textContent = `As of ${data.asOf}`;

  renderKpis(data.kpis);
  renderLineChart("balanceTrend", data.trends.months, data.trends.householdBalance, {
    color: "#1d4ed8",
  });
  renderLineChart("goalsTrend", data.trends.months, data.trends.goalsFundingPct, {
    color: "#0f766e",
  });
  renderGoals(data.goals);
}

renderDashboard();
