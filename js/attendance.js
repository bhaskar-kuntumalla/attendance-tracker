// ============================================================
// attendance.js — Timetable-Aware Attendance Marking Screen
// ============================================================
import { requireAuth, todayISO, formatDate, showToast, friendlyError, withLoading, escapeHTML } from "./utils.js";
import { getSubjects, getAttendanceForDate, markAttendance, getTodayClasses } from "./data.js";

let currentUser = null;
let allSubjects = [];
let todayClasses = [];
let existingAttendance = [];
let selections = new Map(); // key (entry_id or subject_id) -> { subjectId, timetableEntryId, status, periods }
let showAllSubjectsMode = false;

const list = document.getElementById("mark-list");
const dateInput = document.getElementById("attendance-date");
const dateLabel = document.getElementById("date-label");
const saveBtn = document.getElementById("save-attendance-btn");
const toggleModeBtn = document.getElementById("toggle-view-mode-btn");

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function initAttendance() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const params = new URLSearchParams(window.location.search);
  const highlightSubject = params.get("subject");

  dateInput.value = todayISO();
  dateInput.max = todayISO();
  dateInput.addEventListener("change", () => loadForDate(dateInput.value, highlightSubject));

  saveBtn.addEventListener("click", saveAll);

  if (toggleModeBtn) {
    toggleModeBtn.addEventListener("click", () => {
      showAllSubjectsMode = !showAllSubjectsMode;
      toggleModeBtn.textContent = showAllSubjectsMode ? "Show Scheduled Timetable" : "Show All Subjects";
      renderList(highlightSubject);
    });
  }

  try {
    allSubjects = await getSubjects(currentUser.id);
    if (!allSubjects.length) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>No subjects yet</h3>
          <p>Add a subject or upload a timetable to start marking attendance.</p>
          <a href="timetable.html" class="btn btn-primary mt-16">Set Up Timetable</a>
        </div>`;
      saveBtn.style.display = "none";
      return;
    }
    await loadForDate(dateInput.value, highlightSubject);
  } catch (error) {
    showToast(friendlyError(error), "error");
  }
}

async function loadForDate(dateISO, highlightSubject = null) {
  dateLabel.textContent = formatDate(dateISO);
  list.innerHTML = Array(3).fill('<div class="skeleton" style="height:60px;margin-bottom:10px;"></div>').join("");

  const selectedDate = new Date(dateISO + "T00:00:00");
  const dayName = DAYS[selectedDate.getDay()];

  try {
    const [fetchedClasses, fetchedAttendance] = await Promise.all([
      getTodayClasses(currentUser.id, dayName),
      getAttendanceForDate(currentUser.id, dateISO),
    ]);

    todayClasses = fetchedClasses || [];
    existingAttendance = fetchedAttendance || [];
    selections = new Map();

    // Map existing attendance records
    const attendanceByEntry = new Map();
    const attendanceBySubject = new Map();

    for (const r of existingAttendance) {
      if (r.timetable_entry_id) attendanceByEntry.set(r.timetable_entry_id, r);
      else attendanceBySubject.set(r.subject_id, r);
    }

    if (todayClasses.length > 0 && !showAllSubjectsMode) {
      // Scheduled timetable sessions mode
      for (const c of todayClasses) {
        const rec = attendanceByEntry.get(c.id) || attendanceBySubject.get(c.subject_id);
        const key = c.id;
        selections.set(key, {
          subjectId: c.subject_id,
          timetableEntryId: c.id,
          status: rec ? rec.status : null,
          periods: rec ? rec.periods : c.period_count || 1,
          timeLabel: `${c.start_time || ""} - ${c.end_time || ""}`,
          subjectName: c.subject ? c.subject.subject_name : "Subject",
          isLab: c.period_count > 1,
        });
      }
    } else {
      // Fallback: All subjects mode
      for (const s of allSubjects) {
        const rec = attendanceBySubject.get(s.id);
        const key = s.id;
        selections.set(key, {
          subjectId: s.id,
          timetableEntryId: null,
          status: rec ? rec.status : null,
          periods: rec ? rec.periods : s.default_periods || 1,
          timeLabel: `Default: ${s.default_periods} period(s)`,
          subjectName: s.subject_name,
          isLab: s.subject_type === "LAB",
        });
      }
    }

    renderList(highlightSubject);
  } catch (error) {
    showToast(friendlyError(error), "error");
  }
}

function renderList(highlightSubject = null) {
  const items = Array.from(selections.entries());

  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No classes scheduled for this date</h3>
        <p>Click "Show All Subjects" to manually mark attendance for unscheduled classes.</p>
      </div>`;
    return;
  }

  list.innerHTML = items
    .map(([key, item]) => {
      const isHighlighted = highlightSubject === item.subjectId;
      return `
        <div class="mark-row ${isHighlighted ? "highlight" : ""}" data-key="${key}">
          <div class="info">
            <div class="subject-name">${escapeHTML(item.subjectName)}</div>
            <div class="periods-note">${item.timeLabel} · ${item.isLab ? "Lab" : "Theory"}</div>
          </div>
          <input type="number" class="periods-input" min="1" value="${item.periods}" data-periods="${key}" title="Periods" />
          <div class="status-toggle" data-toggle="${key}">
            <button type="button" data-status="present" class="${item.status === "present" ? "active" : ""}">Present</button>
            <button type="button" data-status="absent" class="${item.status === "absent" ? "active" : ""}">Absent</button>
            <button type="button" data-status="cancelled" class="${item.status === "cancelled" ? "active" : ""}">Cancelled</button>
          </div>
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-toggle]").forEach((group) => {
    const key = group.dataset.toggle;
    group.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const sel = selections.get(key);
        if (sel) {
          sel.status = btn.dataset.status;
          selections.set(key, sel);
        }
      });
    });
  });

  list.querySelectorAll("[data-periods]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.periods;
      const sel = selections.get(key);
      const val = parseInt(input.value, 10);
      if (sel) {
        sel.periods = val > 0 ? val : 1;
        selections.set(key, sel);
      }
    });
  });
}

async function saveAll() {
  const toSave = Array.from(selections.values()).filter((item) => item.status);
  if (!toSave.length) {
    showToast("Select Present, Absent, or Cancelled for at least one class.", "info");
    return;
  }

  await withLoading(saveBtn, "Saving...", async () => {
    const results = await Promise.allSettled(
      toSave.map((item) =>
        markAttendance(currentUser.id, {
          subjectId: item.subjectId,
          date: dateInput.value,
          status: item.status,
          periods: item.periods,
          timetableEntryId: item.timetableEntryId,
        })
      )
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      showToast(friendlyError(failed[0].reason), "error");
    } else {
      showToast(`Attendance saved for ${toSave.length} session${toSave.length > 1 ? "s" : ""}.`, "success");
    }
    await loadForDate(dateInput.value);
  });
}
