// ============================================================
// analytics.js
// ============================================================
import {
  requireAuth, pct, attendanceStatus, formatDate, showToast, friendlyError,
  simulateNextPeriod, periodsToReachTarget, periodsCanMiss, escapeHTML,
} from "./utils.js";
import { getProfile, getSubjectsWithStats, overallStats } from "./data.js";

let target = 75;
let subjects = []; // subjects with .rows/.present/.absent/.total
let allAttendance = []; // flattened { ...row, subject_name }

export async function initAnalytics() {
  const user = await requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab") || "overview";
  const initialSubject = params.get("subject");

  try {
    const [profile, subjectsWithStats] = await Promise.all([getProfile(user.id), getSubjectsWithStats(user.id)]);
    target = Number(profile.attendance_target) || 75;
    subjects = subjectsWithStats;
    allAttendance = subjects.flatMap((s) => s.rows.map((r) => ({ ...r, subject_name: s.subject_name })));

    renderOverview();
    renderSimulator(initialSubject);
    renderHistoryFilters(initialSubject);
    renderHistory();
    renderAbsences();
    wireTabs(initialTab);
  } catch (error) {
    showToast(friendlyError(error), "error");
  }
}

/* ---------------- Tabs ---------------- */

function wireTabs(initialTab) {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
  activateTab(initialTab);
}

function activateTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
}

/* ---------------- Overview ---------------- */

function renderOverview() {
  const overall = overallStats(subjects);
  const overallPct = pct(overall.present, overall.total);

  const withData = subjects.filter((s) => s.total > 0);
  const best = withData.length ? withData.reduce((a, b) => (pct(b.present, b.total) > pct(a.present, a.total) ? b : a)) : null;
  const worst = withData.length ? withData.reduce((a, b) => (pct(b.present, b.total) < pct(a.present, a.total) ? b : a)) : null;
  const below = withData.filter((s) => pct(s.present, s.total) < target).length;
  const above = withData.filter((s) => pct(s.present, s.total) >= target).length;

  document.getElementById("ov-overall").textContent = overallPct === null ? "—" : `${overallPct}%`;
  document.getElementById("ov-total").textContent = overall.total;
  document.getElementById("ov-present").textContent = overall.present;
  document.getElementById("ov-absent").textContent = overall.absent;
  document.getElementById("ov-best").textContent = best ? best.subject_name : "—";
  document.getElementById("ov-best-pct").textContent = best ? `${pct(best.present, best.total)}%` : "";
  document.getElementById("ov-worst").textContent = worst ? worst.subject_name : "—";
  document.getElementById("ov-worst-pct").textContent = worst ? `${pct(worst.present, worst.total)}%` : "";
  document.getElementById("ov-below").textContent = below;
  document.getElementById("ov-above").textContent = above;

  const chart = document.getElementById("chart");
  if (!withData.length) {
    chart.innerHTML = `<div class="empty-state"><h3>No attendance recorded yet</h3><p>Mark attendance to see your chart.</p></div>`;
    return;
  }
  chart.innerHTML = withData
    .map((s) => {
      const p = pct(s.present, s.total);
      const st = attendanceStatus(s.present, s.total, target);
      return `
        <div class="chart-row">
          <div class="chart-label">${escapeHTML(s.subject_name)}</div>
          <div class="chart-track"><div class="chart-fill ${st.level}" style="width:${p}%"></div></div>
          <div class="chart-pct">${p}%</div>
        </div>`;
    })
    .join("");
}

/* ---------------- Simulator ---------------- */

function renderSimulator(preselectSubject) {
  const select = document.getElementById("sim-subject-select");
  select.innerHTML = subjects.map((s) => `<option value="${s.id}">${escapeHTML(s.subject_name)}</option>`).join("");
  if (preselectSubject && subjects.some((s) => s.id === preselectSubject)) select.value = preselectSubject;

  select.addEventListener("change", () => updateSimulator(select.value));
  if (subjects.length) updateSimulator(select.value);
  else document.getElementById("sim-body").innerHTML = `<div class="empty-state"><h3>No subjects yet</h3></div>`;
}

function updateSimulator(subjectId) {
  const s = subjects.find((x) => x.id === subjectId);
  const body = document.getElementById("sim-body");
  if (!s) { body.innerHTML = ""; return; }

  const sim = simulateNextPeriod(s.present, s.total, target);
  const need = periodsToReachTarget(s.present, s.total, target);
  const canMiss = periodsCanMiss(s.present, s.total, target);

  let message;
  if (s.total === 0) {
    message = "No attendance recorded yet for this subject.";
  } else if (need > 0) {
    message = `You are below your target. Attend the next ${need} period${need > 1 ? "s" : ""} to reach ${target}%.`;
  } else if (canMiss > 0) {
    message = `You can miss ${canMiss} more period${canMiss > 1 ? "s" : ""} and remain at or above ${target}%.`;
  } else {
    message = `You're exactly at your ${target}% target — attending is the only way to stay there.`;
  }

  body.innerHTML = `
    <div class="sim-cards">
      <div class="sim-card">
        <div class="sim-pct">${sim.current === null ? "—" : sim.current + "%"}</div>
        <div class="sim-label">Current Attendance</div>
      </div>
      <div class="sim-card up">
        <div class="sim-pct">${sim.ifPresent === null ? "—" : sim.ifPresent + "%"}</div>
        <div class="sim-label">If Present Next Period</div>
      </div>
      <div class="sim-card down">
        <div class="sim-pct">${sim.ifAbsent === null ? "—" : sim.ifAbsent + "%"}</div>
        <div class="sim-label">If Absent Next Period</div>
      </div>
    </div>
    <div class="sim-message">${message}</div>`;
}

/* ---------------- History ---------------- */

function renderHistoryFilters(preselectSubject) {
  const subjectSelect = document.getElementById("filter-subject");
  subjectSelect.innerHTML =
    `<option value="">All Subjects</option>` +
    subjects.map((s) => `<option value="${s.id}">${escapeHTML(s.subject_name)}</option>`).join("");
  if (preselectSubject) subjectSelect.value = preselectSubject;

  document.getElementById("filter-subject").addEventListener("change", renderHistory);
  document.getElementById("filter-status").addEventListener("change", renderHistory);
  document.getElementById("filter-from").addEventListener("change", renderHistory);
  document.getElementById("filter-to").addEventListener("change", renderHistory);
}

function renderHistory() {
  const subjectId = document.getElementById("filter-subject").value;
  const status = document.getElementById("filter-status").value;
  const from = document.getElementById("filter-from").value;
  const to = document.getElementById("filter-to").value;

  let rows = [...allAttendance];
  if (subjectId) rows = rows.filter((r) => r.subject_id === subjectId);
  if (status) rows = rows.filter((r) => r.status === status);
  if (from) rows = rows.filter((r) => r.attendance_date >= from);
  if (to) rows = rows.filter((r) => r.attendance_date <= to);
  rows.sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));

  const tbody = document.getElementById("history-body");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><h3>No records match</h3><p>Try a different filter.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (r) => `
        <tr>
          <td>${formatDate(r.attendance_date)}</td>
          <td>${escapeHTML(r.subject_name)}</td>
          <td><span class="status-pill ${r.status}">${r.status}</span></td>
          <td>${r.periods}</td>
        </tr>`
    )
    .join("");
}

/* ---------------- Absences ---------------- */

function renderAbsences() {
  const absences = allAttendance.filter((r) => r.status === "absent").sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));
  const list = document.getElementById("absent-list");
  const totalEl = document.getElementById("absent-total");

  const total = absences.reduce((sum, r) => sum + r.periods, 0);
  totalEl.textContent = total;

  if (!absences.length) {
    list.innerHTML = `<div class="empty-state"><h3>No absences recorded</h3><p>Great consistency — keep it up.</p></div>`;
    return;
  }

  list.innerHTML = absences
    .map(
      (r) => `
        <div class="absent-item">
          <div>
            <div class="subject-name">${escapeHTML(r.subject_name)}</div>
            <div class="absent-date">${formatDate(r.attendance_date)}</div>
          </div>
          <div class="periods-tag">${r.periods} period${r.periods > 1 ? "s" : ""}</div>
        </div>`
    )
    .join("");
}

