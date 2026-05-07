const app = document.querySelector("#app");

const state = {
  status: null,
  dashboard: null,
  days: Number(localStorage.getItem("rc:days") || 30),
  tab: localStorage.getItem("rc:tab") || "overview",
  tags: JSON.parse(localStorage.getItem("rc:tags") || "{}"),
  loading: true,
  error: "",
};

const navItems = [
  ["overview", "Overview", iconGauge()],
  ["coach", "Coach", iconSpark()],
  ["sleep", "Sleep", iconMoon()],
  ["strain", "Strain", iconActivity()],
  ["habits", "Habits", iconTag()],
];

function msToHours(ms) {
  return Number(ms || 0) / 1000 / 60 / 60;
}

function formatHours(ms) {
  if (!ms && ms !== 0) return "--";
  return `${msToHours(ms).toFixed(1)}h`;
}

function formatDate(value, options = {}) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", ...options }).format(new Date(value));
}

function fmt(value, suffix = "", digits = 0) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function byTimeDesc(a, b) {
  const aTime = new Date(a.end || a.updated_at || a.created_at || a.start || 0).getTime();
  const bTime = new Date(b.end || b.updated_at || b.created_at || b.start || 0).getTime();
  return bTime - aTime;
}

function latest(records) {
  return [...(records || [])].sort(byTimeDesc)[0] || null;
}

function scoreColor(score) {
  if (score >= 67) return "green";
  if (score >= 34) return "amber";
  return "coral";
}

function dayKey(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function saveTags() {
  localStorage.setItem("rc:tags", JSON.stringify(state.tags));
}

function setTab(tab) {
  state.tab = tab;
  localStorage.setItem("rc:tab", tab);
  render();
}

function setDays(days) {
  state.days = days;
  localStorage.setItem("rc:days", String(days));
  loadDashboard();
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

async function boot() {
  state.loading = true;
  render();
  try {
    state.status = await api("/api/status");
    if (state.status.authenticated) await loadDashboard(false);
    else {
      state.dashboard = null;
      state.loading = false;
      render();
    }
  } catch (error) {
    state.error = error.message;
    state.loading = false;
    render();
  }
}

async function connect() {
  try {
    const payload = await api("/api/auth-url");
    window.location.href = payload.url;
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function disconnect() {
  await api("/api/logout", { method: "POST" });
  state.dashboard = null;
  state.status = await api("/api/status");
  render();
}

async function loadDashboard(showSpinner = true) {
  if (showSpinner) {
    state.loading = true;
    state.error = "";
    render();
  }

  try {
    state.dashboard = await api(`/api/dashboard?days=${state.days}`);
    state.status = await api("/api/status");
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

function metrics() {
  const data = state.dashboard || {};
  const recovery = latest(data.recovery);
  const sleep = latest(data.sleep);
  const cycle = latest(data.cycle);
  const recentWorkouts = [...(data.workout || [])].sort(byTimeDesc).slice(0, 8);
  const recoveryScore = recovery?.score?.recovery_score ?? null;
  const hrv = recovery?.score?.hrv_rmssd_milli ?? null;
  const rhr = recovery?.score?.resting_heart_rate ?? null;
  const sleepPerformance = sleep?.score?.sleep_performance_percentage ?? null;
  const sleepNeeded = sleep?.score?.sleep_needed || {};
  const stageSummary = sleep?.score?.stage_summary || {};
  const sleepDebtMs = sleepNeeded.need_from_sleep_debt_milli || 0;
  const sleepActualMs =
    (stageSummary.total_light_sleep_time_milli || 0) +
    (stageSummary.total_slow_wave_sleep_time_milli || 0) +
    (stageSummary.total_rem_sleep_time_milli || 0);
  const strain = cycle?.score?.strain ?? null;
  const todayWorkouts = recentWorkouts.filter((workout) => dayKey(workout.start) === dayKey()).length;
  const hrvSeries = (data.recovery || [])
    .filter((item) => item.score?.hrv_rmssd_milli)
    .map((item) => item.score.hrv_rmssd_milli);
  const avgHrv = average(hrvSeries);
  const strainTarget = recoveryScore >= 75 ? 15 : recoveryScore >= 55 ? 11 : recoveryScore >= 35 ? 7 : 4;
  const readiness =
    recoveryScore === null
      ? "Connect WHOOP"
      : recoveryScore >= 67 && sleepPerformance >= 70
        ? "Train"
        : recoveryScore >= 34
          ? "Maintain"
          : "Recover";

  return {
    recovery,
    sleep,
    cycle,
    recentWorkouts,
    recoveryScore,
    hrv,
    rhr,
    sleepPerformance,
    sleepDebtMs,
    sleepActualMs,
    strain,
    todayWorkouts,
    avgHrv,
    strainTarget,
    readiness,
  };
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value)));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + Number(value), 0) / nums.length;
}

function trendRows() {
  const data = state.dashboard || {};
  const rows = new Map();

  for (const recovery of data.recovery || []) {
    const key = dayKey(recovery.created_at || recovery.updated_at);
    rows.set(key, { ...(rows.get(key) || {}), date: key, recovery: recovery.score?.recovery_score, hrv: recovery.score?.hrv_rmssd_milli });
  }
  for (const sleep of data.sleep || []) {
    const key = dayKey(sleep.end || sleep.start);
    rows.set(key, { ...(rows.get(key) || {}), date: key, sleep: sleep.score?.sleep_performance_percentage });
  }
  for (const cycle of data.cycle || []) {
    const key = dayKey(cycle.start || cycle.end);
    rows.set(key, { ...(rows.get(key) || {}), date: key, strain: cycle.score?.strain });
  }

  return [...rows.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function coachItems() {
  const m = metrics();
  const items = [];
  if (m.recoveryScore === null) return items;

  if (m.recoveryScore >= 67) {
    items.push(["green", "High readiness", `Recovery is ${m.recoveryScore}%. Build the day around your highest quality training block.`]);
  } else if (m.recoveryScore >= 34) {
    items.push(["amber", "Controlled output", `Recovery is ${m.recoveryScore}%. Keep intensity honest and stop before form degrades.`]);
  } else {
    items.push(["coral", "Recovery priority", `Recovery is ${m.recoveryScore}%. Keep strain low and protect sleep tonight.`]);
  }

  if (m.hrv && m.avgHrv) {
    const delta = ((m.hrv - m.avgHrv) / m.avgHrv) * 100;
    const color = delta >= 8 ? "green" : delta <= -8 ? "coral" : "amber";
    items.push([color, "HRV vs baseline", `HRV is ${fmt(m.hrv, " ms", 1)}, ${Math.abs(delta).toFixed(0)}% ${delta >= 0 ? "above" : "below"} the ${state.days}-day average.`]);
  }

  if (m.sleepDebtMs > 0) {
    const hours = msToHours(m.sleepDebtMs);
    items.push([hours >= 2 ? "coral" : "amber", "Sleep debt", `${hours.toFixed(1)} hours of sleep debt. Move bedtime earlier before adding more load.`]);
  }

  const strainGap = m.strainTarget - Number(m.strain || 0);
  items.push([
    strainGap > 4 ? "green" : strainGap > 0 ? "amber" : "coral",
    "Strain budget",
    `Current strain is ${fmt(m.strain, "", 1)}. Suggested ceiling today is around ${m.strainTarget}.`,
  ]);

  if (m.todayWorkouts > 0) {
    items.push(["cobalt", "Training logged", `${m.todayWorkouts} workout${m.todayWorkouts === 1 ? "" : "s"} recorded today. Review zone distribution before adding volume.`]);
  }

  return items;
}

function habitStats() {
  const rows = trendRows().filter((row) => row.recovery !== undefined);
  const habits = ["caffeineLate", "alcohol", "lateMeal", "travel", "stress", "soreness"];
  return habits.map((habit) => {
    const tagged = rows.filter((row) => state.tags[row.date]?.[habit]);
    const untagged = rows.filter((row) => !state.tags[row.date]?.[habit]);
    return {
      habit,
      taggedCount: tagged.length,
      taggedRecovery: average(tagged.map((row) => row.recovery)),
      untaggedRecovery: average(untagged.map((row) => row.recovery)),
    };
  });
}

function render() {
  app.innerHTML = `
    <main class="shell">
      ${sidebar()}
      <section class="workspace">
        ${topbar()}
        ${state.error ? `<div class="banner danger">${escapeHtml(state.error)}</div>` : ""}
        ${state.loading ? loadingView() : state.status?.authenticated ? dashboardView() : connectView()}
      </section>
    </main>
  `;
  bindEvents();
}

function sidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">RC</div>
        <div>
          <strong>Recovery Compass</strong>
          <span>Local WHOOP Intelligence</span>
        </div>
      </div>
      <nav class="nav">
        ${navItems.map(([id, label, icon]) => `
          <button class="nav-item ${state.tab === id ? "active" : ""}" data-tab="${id}">
            ${icon}<span>${label}</span>
          </button>
        `).join("")}
      </nav>
      <div class="privacy-note">
        <strong>Local-first</strong>
        <span>Secrets stay server-side. Tokens are stored on this Mac.</span>
      </div>
    </aside>
  `;
}

function topbar() {
  const profile = state.dashboard?.profile;
  const name = profile?.first_name ? `${profile.first_name} ${profile.last_name || ""}`.trim() : "Sai Teja";
  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">${state.status?.authenticated ? "WHOOP connected" : "WHOOP not connected"}</p>
        <h1>${state.status?.authenticated ? `${name}'s readiness cockpit` : "Connect real WHOOP data"}</h1>
      </div>
      <div class="top-actions">
        ${state.status?.authenticated ? rangeControl() : ""}
        ${state.status?.authenticated ? `<button class="ghost" id="refresh">${iconRefresh()} Refresh</button>` : ""}
        ${state.status?.authenticated ? `<button class="ghost" id="disconnect">${iconLogout()} Disconnect</button>` : `<button class="primary" id="connect">${iconLink()} Connect WHOOP</button>`}
      </div>
    </header>
  `;
}

function rangeControl() {
  return `
    <div class="segments">
      ${[14, 30, 90].map((days) => `<button class="${state.days === days ? "active" : ""}" data-days="${days}">${days}d</button>`).join("")}
    </div>
  `;
}

function loadingView() {
  return `
    <section class="loading-panel">
      <div class="pulse-ring"></div>
      <h2>Reading WHOOP data</h2>
      <p>Fetching recovery, sleep, cycles, workouts, profile, and body metrics through your OAuth grant.</p>
    </section>
  `;
}

function connectView() {
  return `
    <section class="connect-grid">
      <div class="connect-copy">
        <h2>No fake metrics. Connect once and this becomes your live recovery cockpit.</h2>
        <p>The app reads WHOOP data through OAuth. Your client secret stays in the local Node server; the browser only receives normalized health metrics.</p>
        <button class="primary large" id="connect">${iconLink()} Connect WHOOP</button>
      </div>
      <div class="setup-panel">
        <h3>Expected OAuth settings</h3>
        <dl>
          <dt>Redirect URI</dt>
          <dd><code>${escapeHtml(state.status?.redirectUri || "")}</code></dd>
          <dt>Scopes</dt>
          <dd>${escapeHtml(state.status?.scopes || "")}</dd>
          <dt>Status</dt>
          <dd>${state.status?.configured ? "Credentials found locally" : "Missing local credentials"}</dd>
        </dl>
      </div>
    </section>
  `;
}

function dashboardView() {
  if (!state.dashboard) return loadingView();
  if (!hasAnyRecords()) return emptyDataView();

  return `
    ${state.tab === "overview" ? overviewView() : ""}
    ${state.tab === "coach" ? coachView() : ""}
    ${state.tab === "sleep" ? sleepView() : ""}
    ${state.tab === "strain" ? strainView() : ""}
    ${state.tab === "habits" ? habitsView() : ""}
  `;
}

function hasAnyRecords() {
  const data = state.dashboard || {};
  return Boolean((data.recovery || []).length || (data.sleep || []).length || (data.cycle || []).length || (data.workout || []).length);
}

function emptyDataView() {
  return `
    <section class="empty-state">
      <h2>WHOOP is connected, but no records came back for this range.</h2>
      <p>Try a wider range or verify that the app scopes include recovery, cycles, sleep, and workout data.</p>
      ${state.dashboard?.errors?.length ? `<pre>${escapeHtml(JSON.stringify(state.dashboard.errors, null, 2))}</pre>` : ""}
    </section>
  `;
}

function overviewView() {
  const m = metrics();
  const color = scoreColor(m.recoveryScore || 0);
  return `
    <section class="dashboard-grid overview-grid">
      <article class="panel readiness ${color}">
        <div class="panel-heading">
          <span>Today</span>
          <strong>${formatDate(new Date(), { weekday: "short" })}</strong>
        </div>
        <div class="readiness-score">
          <span>${fmt(m.recoveryScore, "%")}</span>
          <strong>${m.readiness}</strong>
        </div>
        <p>${primaryRecommendation()}</p>
      </article>
      ${metricCard("HRV", fmt(m.hrv, " ms", 1), "Latest recovery", "green")}
      ${metricCard("Resting HR", fmt(m.rhr, " bpm"), "Lower is usually better", "coral")}
      ${metricCard("Sleep", fmt(m.sleepPerformance, "%"), `${formatHours(m.sleepActualMs)} actual`, "cobalt")}
      ${metricCard("Strain", fmt(m.strain, "", 1), `Target ${m.strainTarget}`, "amber")}
      <article class="panel chart-panel wide">
        <div class="panel-heading">
          <span>${state.days}-day signal</span>
          <strong>Recovery, sleep, strain</strong>
        </div>
        ${lineChart(trendRows(), ["recovery", "sleep", "strain"])}
      </article>
      <article class="panel coach-panel">
        <div class="panel-heading">
          <span>Operating brief</span>
          <strong>Next best actions</strong>
        </div>
        ${coachList(coachItems().slice(0, 4))}
      </article>
      <article class="panel table-panel wide">
        <div class="panel-heading">
          <span>Recent workouts</span>
          <strong>${state.dashboard.workout?.length || 0} in range</strong>
        </div>
        ${workoutTable(metrics().recentWorkouts)}
      </article>
    </section>
  `;
}

function coachView() {
  const items = coachItems();
  const m = metrics();
  return `
    <section class="coach-layout">
      <article class="panel coach-brief">
        <div class="panel-heading"><span>AI-style assessment</span><strong>Today's plan</strong></div>
        <h2>${m.readiness}: ${primaryRecommendation()}</h2>
        ${coachList(items)}
      </article>
      <article class="panel">
        <div class="panel-heading"><span>Load guardrails</span><strong>Decision logic</strong></div>
        <div class="rules">
          ${rule("Green", "Recovery >= 67 and sleep >= 70: allow hard training if soreness is low.")}
          ${rule("Yellow", "Recovery 34-66: keep quality but reduce volume or cap intervals.")}
          ${rule("Red", "Recovery < 34: mobility, walk, zone 1, or full rest.")}
          ${rule("Sleep debt", "When debt is above 2h, protect bedtime before chasing strain.")}
        </div>
      </article>
    </section>
  `;
}

function sleepView() {
  const m = metrics();
  const sleep = m.sleep;
  const stage = sleep?.score?.stage_summary || {};
  return `
    <section class="dashboard-grid">
      ${metricCard("Performance", fmt(m.sleepPerformance, "%"), "Latest sleep score", "cobalt")}
      ${metricCard("Sleep debt", formatHours(m.sleepDebtMs), "Need from sleep debt", "amber")}
      ${metricCard("Actual sleep", formatHours(m.sleepActualMs), "Light + SWS + REM", "green")}
      ${metricCard("Respiratory", fmt(sleep?.score?.respiratory_rate, " rpm", 1), "Latest sleep", "coral")}
      <article class="panel wide">
        <div class="panel-heading"><span>Sleep architecture</span><strong>${formatDate(sleep?.end || sleep?.start)}</strong></div>
        <div class="stage-bars">
          ${stageBar("Awake", stage.total_awake_time_milli, "coral")}
          ${stageBar("Light", stage.total_light_sleep_time_milli, "cobalt")}
          ${stageBar("SWS", stage.total_slow_wave_sleep_time_milli, "green")}
          ${stageBar("REM", stage.total_rem_sleep_time_milli, "amber")}
        </div>
      </article>
      <article class="panel wide">
        <div class="panel-heading"><span>Sleep trend</span><strong>${state.days} days</strong></div>
        ${lineChart(trendRows(), ["sleep"])}
      </article>
    </section>
  `;
}

function strainView() {
  return `
    <section class="dashboard-grid">
      ${metricCard("Daily strain", fmt(metrics().strain, "", 1), "Latest cycle", "amber")}
      ${metricCard("Workouts", String(state.dashboard.workout?.length || 0), `${state.days}-day range`, "cobalt")}
      ${metricCard("Suggested ceiling", fmt(metrics().strainTarget, "", 0), "Today", "green")}
      ${metricCard("Calories", fmt(metrics().cycle?.score?.kilojoule ? metrics().cycle.score.kilojoule / 4.184 : null, " kcal"), "Cycle estimate", "coral")}
      <article class="panel wide">
        <div class="panel-heading"><span>Strain trend</span><strong>Cycles</strong></div>
        ${lineChart(trendRows(), ["strain"])}
      </article>
      <article class="panel table-panel wide">
        <div class="panel-heading"><span>Workout detail</span><strong>Heart-rate zones</strong></div>
        ${workoutTable(metrics().recentWorkouts, true)}
      </article>
    </section>
  `;
}

function habitsView() {
  const rows = trendRows().slice(-14).reverse();
  return `
    <section class="habits-layout">
      <article class="panel">
        <div class="panel-heading"><span>Manual context</span><strong>Tag the days</strong></div>
        <div class="tag-days">
          ${rows.map((row) => dayTagRow(row)).join("")}
        </div>
      </article>
      <article class="panel">
        <div class="panel-heading"><span>Correlation hints</span><strong>Recovery impact</strong></div>
        <div class="habit-stats">
          ${habitStats().map((stat) => habitStatRow(stat)).join("")}
        </div>
      </article>
    </section>
  `;
}

function metricCard(label, value, note, color) {
  return `
    <article class="panel metric ${color}">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${note}</small>
    </article>
  `;
}

function primaryRecommendation() {
  const m = metrics();
  if (m.recoveryScore === null) return "Connect WHOOP to generate today's plan.";
  if (m.readiness === "Train") return "Push the main session, then shut down early enough to defend sleep.";
  if (m.readiness === "Maintain") return "Use a moderate session and treat sleep as the performance target.";
  return "Keep strain low, move lightly, hydrate, and make tonight boring.";
}

function coachList(items) {
  if (!items.length) return `<p class="muted">Connect WHOOP to generate coaching notes.</p>`;
  return `<div class="coach-list">${items.map(([color, title, body]) => `
    <div class="coach-item ${color}">
      <span></span>
      <div><strong>${title}</strong><p>${body}</p></div>
    </div>
  `).join("")}</div>`;
}

function rule(title, body) {
  return `<div class="rule"><strong>${title}</strong><p>${body}</p></div>`;
}

function stageBar(label, ms, color) {
  const hours = msToHours(ms);
  const width = Math.max(2, Math.min(100, (hours / 8) * 100));
  return `
    <div class="stage-row">
      <span>${label}</span>
      <div><i class="${color}" style="width:${width}%"></i></div>
      <strong>${formatHours(ms)}</strong>
    </div>
  `;
}

function workoutTable(workouts, showZones = false) {
  if (!workouts.length) return `<p class="muted">No workouts returned in this range.</p>`;
  return `
    <table>
      <thead><tr><th>Date</th><th>Sport</th><th>Strain</th><th>Avg HR</th><th>Max HR</th>${showZones ? "<th>Zones</th>" : ""}</tr></thead>
      <tbody>
        ${workouts.map((workout) => `
          <tr>
            <td>${formatDate(workout.start)}</td>
            <td>${escapeHtml(workout.sport_name || workout.sport_id || "Workout")}</td>
            <td>${fmt(workout.score?.strain, "", 1)}</td>
            <td>${fmt(workout.score?.average_heart_rate, " bpm")}</td>
            <td>${fmt(workout.score?.max_heart_rate, " bpm")}</td>
            ${showZones ? `<td>${zoneStrip(workout.score?.zone_durations || {})}</td>` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function zoneStrip(zones) {
  const values = [
    zones.zone_zero_milli || 0,
    zones.zone_one_milli || 0,
    zones.zone_two_milli || 0,
    zones.zone_three_milli || 0,
    zones.zone_four_milli || 0,
    zones.zone_five_milli || 0,
  ];
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return `<div class="zone-strip">${values.map((value, index) => `<span class="z${index}" style="width:${(value / total) * 100}%"></span>`).join("")}</div>`;
}

function lineChart(rows, keys) {
  if (!rows.length) return `<p class="muted">No trend data available yet.</p>`;
  const width = 760;
  const height = 230;
  const padding = 24;
  const values = rows.flatMap((row) => keys.map((key) => row[key]).filter((value) => value !== undefined && value !== null));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const span = max - min || 1;
  const x = (index) => padding + (index / Math.max(1, rows.length - 1)) * (width - padding * 2);
  const y = (value) => height - padding - ((Number(value) - min) / span) * (height - padding * 2);
  const colorMap = { recovery: "#16a34a", sleep: "#2563eb", strain: "#f59e0b", hrv: "#0f766e" };

  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="WHOOP trend chart">
      ${[0, 1, 2, 3].map((line) => `<line x1="${padding}" x2="${width - padding}" y1="${padding + line * 55}" y2="${padding + line * 55}" />`).join("")}
      ${keys.map((key) => {
        const points = rows
          .map((row, index) => row[key] === undefined || row[key] === null ? null : `${x(index)},${y(row[key])}`)
          .filter(Boolean)
          .join(" ");
        return `<polyline points="${points}" style="stroke:${colorMap[key] || "#111827"}"></polyline>`;
      }).join("")}
      ${rows.map((row, index) => `<text x="${x(index)}" y="${height - 4}">${index % Math.ceil(rows.length / 6) === 0 ? formatDate(row.date) : ""}</text>`).join("")}
    </svg>
    <div class="legend">${keys.map((key) => `<span><i style="background:${colorMap[key]}"></i>${key}</span>`).join("")}</div>
  `;
}

function dayTagRow(row) {
  const tags = [
    ["caffeineLate", "Late caffeine"],
    ["alcohol", "Alcohol"],
    ["lateMeal", "Late meal"],
    ["travel", "Travel"],
    ["stress", "Stress"],
    ["soreness", "Sore"],
  ];
  return `
    <div class="tag-day">
      <div><strong>${formatDate(row.date, { weekday: "short" })}</strong><span>Recovery ${fmt(row.recovery, "%")} · Sleep ${fmt(row.sleep, "%")}</span></div>
      <div class="tag-buttons">
        ${tags.map(([id, label]) => `<button class="${state.tags[row.date]?.[id] ? "active" : ""}" data-tag="${id}" data-date="${row.date}">${label}</button>`).join("")}
      </div>
    </div>
  `;
}

function habitStatRow(stat) {
  const labels = {
    caffeineLate: "Late caffeine",
    alcohol: "Alcohol",
    lateMeal: "Late meal",
    travel: "Travel",
    stress: "Stress",
    soreness: "Soreness",
  };
  const delta = stat.taggedRecovery !== null && stat.untaggedRecovery !== null ? stat.taggedRecovery - stat.untaggedRecovery : null;
  return `
    <div class="habit-stat">
      <div><strong>${labels[stat.habit]}</strong><span>${stat.taggedCount} tagged day${stat.taggedCount === 1 ? "" : "s"}</span></div>
      <em class="${delta === null ? "" : delta >= 0 ? "good" : "bad"}">${delta === null ? "Need more tags" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} recovery pts`}</em>
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  document.querySelectorAll("[data-days]").forEach((button) => button.addEventListener("click", () => setDays(Number(button.dataset.days))));
  document.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      const date = button.dataset.date;
      const tag = button.dataset.tag;
      state.tags[date] = state.tags[date] || {};
      state.tags[date][tag] = !state.tags[date][tag];
      saveTags();
      render();
    });
  });
  document.querySelectorAll("#connect").forEach((button) => button.addEventListener("click", connect));
  document.querySelector("#refresh")?.addEventListener("click", () => loadDashboard());
  document.querySelector("#disconnect")?.addEventListener("click", disconnect);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function iconGauge() {
  return `<svg viewBox="0 0 24 24"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M12 14l4-5"/><path d="M8 18h8"/></svg>`;
}
function iconSpark() {
  return `<svg viewBox="0 0 24 24"><path d="M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/></svg>`;
}
function iconMoon() {
  return `<svg viewBox="0 0 24 24"><path d="M20 14.4A7.5 7.5 0 0 1 9.6 4a8.5 8.5 0 1 0 10.4 10.4z"/></svg>`;
}
function iconActivity() {
  return `<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>`;
}
function iconTag() {
  return `<svg viewBox="0 0 24 24"><path d="M20 13l-7 7-9-9V4h7z"/><circle cx="8.5" cy="8.5" r="1"/></svg>`;
}
function iconRefresh() {
  return `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/></svg>`;
}
function iconLogout() {
  return `<svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M13 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/></svg>`;
}
function iconLink() {
  return `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>`;
}

boot();
