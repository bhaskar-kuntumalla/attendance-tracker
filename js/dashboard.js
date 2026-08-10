// ============================================================
// dashboard.js — Today's Classes & Quick Attendance Marking
// ============================================================
import { requireAuth, pct, attendanceStatus, showToast, friendlyError, escapeHTML, todayISO } from "./utils.js";
import { getProfile, getSubjectsWithStats, overallStats, getTodayClasses, getAttendanceForDate, markAttendance } from "./data.js";

const badgeClass = { safe: "badge-safe", warning: "badge-warning", critical: "badge-critical", unknown: "badge-unknown" };

function ledgerHTML(rows) {
  const sorted = [...rows].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date)).slice(-30);
  if (!sorted.length) return "";
  return `<div class="ledger">${sorted.map((r) => `<span class="dot ${r.status}" title="${r.attendance_date}: ${r.status}"></span>`).join("")}</div>`;
}

export async function initDashboard() {
  const user = await requireAuth();
  if (!user) return;

  const heroSkeleton = document.getElementById("hero-skeleton");
  const heroContent = document.getElementById("hero-content");
  const subjectList = document.getElementById("subject-list");
  const noTimetableBanner = document.getElementById("no-timetable-banner");
  const todayClassesList = document.getElementById("today-classes-list");
  const todayDayName = document.getElementById("today-day-name");

  // Determine current day of week name
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDay = dayNames[new Date().getDay()];
  if (todayDayName) todayDayName.textContent = currentDay;

  try {
    const [profile, subjects, todayClasses, todayAttendance] = await Promise.all([
      getProfile(user.id),
      getSubjectsWithStats(user.id),
      getTodayClasses(user.id, currentDay),
      getAttendanceForDate(user.id, todayISO()),
    ]);

    const target = Number(profile.attendance_target) || 75;
    const overall = overallStats(subjects);
    const overallPct = pct(overall.present, overall.total);
    const status = attendanceStatus(overall.present, overall.total, target);

    heroSkeleton.style.display = "none";
    heroContent.style.display = "block";

    document.getElementById("greeting-name").textContent = profile.full_name?.split(" ")[0] || "there";
    document.getElementById("hero-pct").textContent = overallPct === null ? "—" : `${overallPct}%`;
    document.getElementById("hero-target").textContent = `Target: ${target}%`;
    const statusBadge = document.getElementById("hero-status");
    statusBadge.textContent = status.label;
    statusBadge.className = `badge ${badgeClass[status.level]}`;

    document.getElementById("stat-total").textContent = overall.total;
    document.getElementById("stat-present").textContent = overall.present;
    document.getElementById("stat-absent").textContent = overall.absent;

    // Show/hide timetable upload prompt banner
    if (!todayClasses || !todayClasses.length) {
      noTimetableBanner.style.display = "block";
    } else {
      noTimetableBanner.style.display = "none";
    }

    // Render TODAY'S CLASSES
    renderTodayClasses(user.id, todayClasses, todayAttendance, todayClassesList);

    // Render Subject List
    if (!subjects.length) {
      subjectList.innerHTML = `
        <div class="empty-state">
          <h3>No subjects yet</h3>
          <p>Add your first subject or upload a timetable to start tracking attendance.</p>
          <a href="timetable.html" class="btn btn-primary mt-16">Set Up Timetable</a>
        </div>`;
      return;
    }

    subjectList.innerHTML = subjects
      .map((s) => {
        const p = pct(s.present, s.total);
        const st = attendanceStatus(s.present, s.total, target);
        return `
          <div class="subject-row">
            <div class="info">
              <div class="subject-name">${escapeHTML(s.subject_name)} ${s.subject_code ? `<span style="font-size:12px;color:#64748b;font-weight:normal;">(${escapeHTML(s.subject_code)})</span>` : ""}</div>
              <div class="subject-meta">${s.present} / ${s.total || 0} periods · ${ledgerHTML(s.rows) || "no records yet"}</div>
            </div>
            <div class="pct-col">
              <div class="pct-num">${p === null ? "—" : p + "%"}</div>
              <span class="badge ${badgeClass[st.level]}">${st.label}</span>
            </div>
          </div>`;
      })
      .join("");
  } catch (error) {
    showToast(friendlyError(error), "error");
    heroSkeleton.style.display = "none";
  }
}

function renderTodayClasses(userId, classes, attendanceRecords, container) {
  if (!classes || !classes.length) {
    container.innerHTML = `
      <div class="card" style="padding:16px;text-align:center;color:#64748b;">
        <p class="text-sm">No scheduled classes for today.</p>
      </div>`;
    return;
  }

  const attendanceMap = new Map();
  for (const rec of attendanceRecords) {
    if (rec.timetable_entry_id) {
      attendanceMap.set(rec.timetable_entry_id, rec);
    } else {
      attendanceMap.set(rec.subject_id, rec);
    }
  }

  container.innerHTML = classes
    .map((c) => {
      const rec = attendanceMap.get(c.id) || attendanceMap.get(c.subject_id);
      const currentStatus = rec ? rec.status : null;
      const subName = c.subject ? c.subject.subject_name : "Class";
      const isLab = c.period_count > 1;

      return `
        <div class="card" style="margin-bottom:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;" data-entry-card="${c.id}">
          <div>
            <div style="font-size:12px;font-weight:600;color:#2563eb;">${c.start_time || "09:00"} - ${c.end_time || "10:00"}</div>
            <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:2px;">${escapeHTML(subName)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">
              ${isLab ? `Lab · ${c.period_count} periods` : "Theory · 1 period"}
            </div>
          </div>
          <div style="display:flex;gap:8px;" data-quick-toggle="${c.id}" data-subject-id="${c.subject_id}" data-periods="${c.period_count || 1}">
            <button type="button" class="btn btn-sm ${currentStatus === "present" ? "btn-primary" : "btn-secondary"}" data-status="present">Present</button>
            <button type="button" class="btn btn-sm ${currentStatus === "absent" ? "btn-danger" : "btn-secondary"}" data-status="absent">Absent</button>
          </div>
        </div>`;
    })
    .join("");

  // Attach quick attendance marking event listeners
  container.querySelectorAll("[data-quick-toggle]").forEach((group) => {
    const entryId = group.dataset.quickToggle;
    const subjectId = group.dataset.subjectId;
    const periods = parseInt(group.dataset.periods, 10) || 1;

    group.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const newStatus = btn.dataset.status;
        try {
          await markAttendance(userId, {
            subjectId,
            date: todayISO(),
            status: newStatus,
            periods,
            timetableEntryId: entryId,
          });

          showToast(`Marked ${newStatus} for today's class!`, "success");
          await initDashboard(); // refresh stats
        } catch (err) {
          showToast(friendlyError(err), "error");
        }
      });
    });
  });
}
