// ============================================================
// subjects.js
// ============================================================
import { requireAuth, pct, attendanceStatus, showToast, friendlyError, withLoading, escapeHTML } from "./utils.js";
import { getProfile, getSubjectsWithStats, createSubject, updateSubject, deleteSubject } from "./data.js";

const badgeClass = { safe: "badge-safe", warning: "badge-warning", critical: "badge-critical", unknown: "badge-unknown" };

let currentUser = null;
let target = 75;
let subjectsCache = [];
let editingId = null;
let deletingId = null;

const grid = document.getElementById("subjects-grid");
const modal = document.getElementById("subject-modal");
const form = document.getElementById("subject-form");
const deleteModal = document.getElementById("delete-modal");

export async function initSubjects() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  wireModal();
  wireDeleteModal();
  await loadSubjects();
}

async function loadSubjects() {
  try {
    const [profile, subjects] = await Promise.all([
      getProfile(currentUser.id),
      getSubjectsWithStats(currentUser.id),
    ]);
    target = Number(profile.attendance_target) || 75;
    subjectsCache = subjects;
    renderGrid();
  } catch (error) {
    showToast(friendlyError(error), "error");
  }
}

function renderGrid() {
  if (!subjectsCache.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <h3>No subjects yet</h3>
        <p>Add a subject manually or upload your timetable photo to auto-create subjects.</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
          <a href="timetable.html" class="btn btn-primary">Set Up Timetable</a>
          <button class="btn btn-secondary" id="empty-add-btn">Add Manually</button>
        </div>
      </div>`;
    document.getElementById("empty-add-btn")?.addEventListener("click", () => openModal());
    return;
  }

  grid.innerHTML = subjectsCache
    .map((s) => {
      const p = pct(s.present, s.total);
      const st = attendanceStatus(s.present, s.total, target);
      const isLab = s.subject_type === "LAB";

      return `
        <div class="card subject-card">
          <div class="top-row">
            <div>
              <div class="subject-name">
                ${escapeHTML(s.subject_name)}
                ${s.subject_code ? `<span style="font-size:12px;color:#64748b;font-weight:normal;">(${escapeHTML(s.subject_code)})</span>` : ""}
              </div>
              <div class="weekly-tag">
                ${isLab ? "Lab" : (s.subject_type || "Theory")} · ${s.weekly_periods} periods/wk · Default ${s.default_periods}/class
              </div>
            </div>
            <span class="badge ${badgeClass[st.level]}">${st.label}</span>
          </div>

          <div class="big-pct">${p === null ? "—" : p + "%"}</div>
          <div class="periods-line">${s.present} / ${s.total || 0} periods</div>
          
          <div class="card-actions">
            <a href="attendance.html?subject=${s.id}" class="btn btn-secondary">Attendance</a>
            <a href="analytics.html?subject=${s.id}&tab=history" class="btn btn-secondary">Details</a>
            <button class="btn btn-secondary" data-edit="${s.id}">Edit</button>
            <button class="btn btn-danger" data-delete="${s.id}">Delete</button>
          </div>
        </div>`;
    })
    .join("");

  grid.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openModal(btn.dataset.edit))
  );
  grid.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => openDeleteModal(btn.dataset.delete))
  );
}

/* ---------------- Add / Edit modal ---------------- */

function wireModal() {
  document.getElementById("add-subject-btn").addEventListener("click", () => openModal());
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.subjectName.value.trim();
    const code = form.subjectCode.value.trim();
    const type = form.subjectType.value;
    const weekly = parseInt(form.weeklyPeriods.value, 10);
    const defaultP = parseInt(form.defaultPeriods.value, 10);
    const errorBanner = form.querySelector(".form-error-banner");
    errorBanner.classList.remove("show");

    if (!name) return fieldFail(form.subjectName, "Subject name is required.");
    if (!weekly || weekly <= 0) return fieldFail(form.weeklyPeriods, "Enter a valid number of weekly periods.");
    if (!defaultP || defaultP <= 0) return fieldFail(form.defaultPeriods, "Enter a valid default periods value.");

    const isDuplicate = subjectsCache.some(
      (s) => s.subject_name.toLowerCase() === name.toLowerCase() && s.id !== editingId
    );
    if (isDuplicate) {
      errorBanner.textContent = "You already have a subject with this name.";
      errorBanner.classList.add("show");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    await withLoading(submitBtn, editingId ? "Saving..." : "Adding...", async () => {
      try {
        if (editingId) {
          await updateSubject(editingId, {
            subject_name: name,
            subject_code: code || null,
            subject_type: type,
            weekly_periods: weekly,
            default_periods: defaultP,
          });
          showToast("Subject updated.", "success");
        } else {
          await createSubject(currentUser.id, {
            subjectName: name,
            subjectCode: code,
            subjectType: type,
            weeklyPeriods: weekly,
            defaultPeriods: defaultP,
          });
          showToast("Subject added.", "success");
        }
        closeModal();
        await loadSubjects();
      } catch (error) {
        errorBanner.textContent = friendlyError(error);
        errorBanner.classList.add("show");
      }
    });
  });
}

function fieldFail(input, message) {
  const field = input.closest(".field");
  field.classList.add("has-error");
  field.querySelector(".field-error").textContent = message;
}

function openModal(subjectId = null) {
  editingId = subjectId;
  form.reset();
  form.querySelectorAll(".field").forEach((f) => f.classList.remove("has-error"));
  form.querySelector(".form-error-banner").classList.remove("show");

  document.getElementById("modal-title").textContent = subjectId ? "Edit Subject" : "Add Subject";
  form.querySelector('button[type="submit"]').textContent = subjectId ? "Save Changes" : "Save Subject";

  if (subjectId) {
    const s = subjectsCache.find((x) => x.id === subjectId);
    if (s) {
      form.subjectName.value = s.subject_name;
      form.subjectCode.value = s.subject_code || "";
      form.subjectType.value = s.subject_type || "THEORY";
      form.weeklyPeriods.value = s.weekly_periods;
      form.defaultPeriods.value = s.default_periods;
    }
  } else {
    form.defaultPeriods.value = 1;
  }

  modal.classList.add("open");
  form.subjectName.focus();
}

function closeModal() {
  modal.classList.remove("open");
  editingId = null;
}

/* ---------------- Delete confirmation ---------------- */

function wireDeleteModal() {
  deleteModal.querySelector(".modal-close").addEventListener("click", closeDeleteModal);
  deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) closeDeleteModal(); });
  document.getElementById("cancel-delete-btn").addEventListener("click", closeDeleteModal);

  document.getElementById("confirm-delete-btn").addEventListener("click", async (e) => {
    if (!deletingId) return;
    await withLoading(e.target, "Deleting...", async () => {
      try {
        await deleteSubject(deletingId);
        showToast("Subject deleted.", "success");
        closeDeleteModal();
        await loadSubjects();
      } catch (error) {
        showToast(friendlyError(error), "error");
      }
    });
  });
}

function openDeleteModal(subjectId) {
  deletingId = subjectId;
  const s = subjectsCache.find((x) => x.id === subjectId);
  document.getElementById("delete-subject-name").textContent = s ? s.subject_name : "this subject";
  deleteModal.classList.add("open");
}

function closeDeleteModal() {
  deleteModal.classList.remove("open");
  deletingId = null;
}
