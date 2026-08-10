// ============================================================
// timetable.js — Controller for timetable.html
// Manages image upload, browser OCR geometry extraction, verification, grid view, and debug overlay.
// ============================================================

import { requireAuth, showToast, friendlyError, withLoading, escapeHTML } from "./utils.js";
import { runTimetableOCR } from "./ocr.js";
import { parseTimetableText, suggestSubjectMerges, DAYS_OF_WEEK, getDefaultPeriods } from "./timetable-parser.js";
import { getTimetableEntries, saveTimetableData, saveTimetableUpload } from "./data.js";

let currentUser = null;
let currentFile = null;
let parsedData = null; // { headerMetadata, periods, entries, abbreviationMap, detectedGrid }
let existingEntries = [];

// DOM Elements
const setupContainer = document.getElementById("setup-container");
const verificationContainer = document.getElementById("verification-container");
const viewContainer = document.getElementById("view-container");
const resetBtn = document.getElementById("reset-timetable-btn");

const optUpload = document.getElementById("opt-upload");
const optManual = document.getElementById("opt-manual");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("timetable-file-input");
const browseBtn = document.getElementById("browse-btn");
const previewBox = document.getElementById("preview-box");
const previewImg = document.getElementById("preview-img");
const previewFilename = document.getElementById("preview-filename");
const removeImgBtn = document.getElementById("remove-img-btn");
const processBtn = document.getElementById("process-ocr-btn");

const ocrProgressCard = document.getElementById("ocr-progress");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressStatusText = document.getElementById("progress-status-text");
const progressPctText = document.getElementById("progress-pct-text");

const verificationDaysList = document.getElementById("verification-days-list");
const dedupBannerSlot = document.getElementById("dedup-banner-slot");
const confirmBtnTop = document.getElementById("confirm-timetable-btn");
const confirmBtnBottom = document.getElementById("confirm-timetable-btn-bottom");
const cancelVerifyBtn = document.getElementById("cancel-verification-btn");
const addEntryBtn = document.getElementById("add-entry-btn");
const showDebugGridBtn = document.getElementById("show-debug-grid-btn");

const debugModal = document.getElementById("debug-modal");
const closeDebugModalBtn = document.getElementById("close-debug-modal-btn");
const debugCanvas = document.getElementById("debug-canvas");

const gridBody = document.getElementById("grid-body");
const mobileList = document.getElementById("mobile-timetable-list");

export async function initTimetable() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  wireUploadControls();
  wireVerificationControls();
  wireDebugModal();

  await checkExistingTimetable();
}

async function checkExistingTimetable() {
  try {
    existingEntries = await getTimetableEntries(currentUser.id);
    if (existingEntries && existingEntries.length > 0) {
      showViewScreen(existingEntries);
      resetBtn.style.display = "inline-flex";
      resetBtn.addEventListener("click", () => showSetupScreen());
    } else {
      showSetupScreen();
    }
  } catch (err) {
    showToast(friendlyError(err), "error");
    showSetupScreen();
  }
}

function showSetupScreen() {
  setupContainer.style.display = "block";
  verificationContainer.style.display = "none";
  viewContainer.style.display = "none";
  resetBtn.style.display = "none";
}

function showVerificationScreen() {
  setupContainer.style.display = "none";
  verificationContainer.style.display = "block";
  viewContainer.style.display = "none";
  if (currentFile && parsedData?.detectedGrid) {
    showDebugGridBtn.style.display = "inline-flex";
  } else {
    showDebugGridBtn.style.display = "none";
  }
}

function showViewScreen(entries) {
  setupContainer.style.display = "none";
  verificationContainer.style.display = "none";
  viewContainer.style.display = "block";
  renderGrid(entries);
}

/* ---------------- Upload & OCR Wiring ---------------- */

function wireUploadControls() {
  optUpload.addEventListener("click", () => {
    optUpload.classList.add("active");
    optManual.classList.remove("active");
    dropzone.style.display = "block";
  });

  optManual.addEventListener("click", () => {
    optManual.classList.add("active");
    optUpload.classList.remove("active");
    parsedData = {
      headerMetadata: {},
      periods: getDefaultPeriods(),
      entries: [
        { day_of_week: "Monday", period_number: 1, subject_name: "Mathematics", subject_code: "MATH", subject_type: "THEORY", period_count: 1, start_time: "09:15", end_time: "10:15" },
        { day_of_week: "Monday", period_number: 2, subject_name: "DBMS Lab", subject_code: "DBMS", subject_type: "LAB", period_count: 2, start_time: "10:15", end_time: "12:25" },
      ],
    };
    renderVerificationForm();
    showVerificationScreen();
  });

  browseBtn.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("click", (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
  });

  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
  });

  removeImgBtn.addEventListener("click", () => {
    currentFile = null;
    fileInput.value = "";
    previewBox.style.display = "none";
    dropzone.style.display = "block";
  });

  processBtn.addEventListener("click", startOCRProcess);
}

function handleFileSelected(file) {
  currentFile = file;
  previewFilename.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
  const url = URL.createObjectURL(file);
  previewImg.src = url;

  dropzone.style.display = "none";
  previewBox.style.display = "block";
}

async function startOCRProcess() {
  if (!currentFile) {
    showToast("Please select a timetable image first.", "info");
    return;
  }

  ocrProgressCard.style.display = "block";
  processBtn.disabled = true;

  try {
    const ocrResult = await runTimetableOCR(currentFile, (progressInfo) => {
      progressBarFill.style.width = `${progressInfo.progress}%`;
      progressPctText.textContent = `${progressInfo.progress}%`;
      progressStatusText.textContent = progressInfo.message;

      if (progressInfo.progress >= 20) document.getElementById("step-1").classList.add("completed");
      if (progressInfo.progress >= 35) document.getElementById("step-2").classList.add("completed");
      if (progressInfo.progress >= 70) document.getElementById("step-3").classList.add("completed");
      if (progressInfo.progress >= 95) document.getElementById("step-4").classList.add("completed");
    });

    // Pass image file blob along with OCR text/words to geometry parser
    parsedData = await parseTimetableText(ocrResult, currentFile);

    saveTimetableUpload(currentUser.id, {
      fileType: currentFile.type,
      rawText: ocrResult.rawText,
      parsedData,
    }).catch((e) => console.warn("Upload record log warning:", e));

    if (!parsedData.entries || parsedData.entries.length === 0) {
      showToast("Could not detect clear timetable structure. Switching to manual verification mode.", "info");
      parsedData.entries = [
        { day_of_week: "Monday", period_number: 1, subject_name: "Subject 1", subject_code: "SUB1", subject_type: "THEORY", period_count: 1, start_time: "09:15", end_time: "10:15" },
      ];
    } else {
      showToast(`Extracted ${parsedData.entries.length} class entries dynamically! Please verify below.`, "success");
    }

    renderVerificationForm();
    showVerificationScreen();
  } catch (err) {
    showToast(friendlyError(err), "error");
  } finally {
    ocrProgressCard.style.display = "none";
    processBtn.disabled = false;
  }
}

/* ---------------- Verification Screen Wiring ---------------- */

function wireVerificationControls() {
  cancelVerifyBtn.addEventListener("click", () => showSetupScreen());

  confirmBtnTop.addEventListener("click", saveConfirmedTimetable);
  confirmBtnBottom.addEventListener("click", saveConfirmedTimetable);

  addEntryBtn.addEventListener("click", () => {
    parsedData.entries.push({
      day_of_week: "Monday",
      period_number: (parsedData.entries.length % 6) + 1,
      subject_name: "New Subject",
      subject_code: "",
      subject_type: "THEORY",
      period_count: 1,
      start_time: "09:15",
      end_time: "10:15",
    });
    renderVerificationForm();
  });
}

function renderVerificationForm() {
  const meta = parsedData.headerMetadata || {};
  const hasMeta = meta.branch || meta.semester || meta.section || meta.academicYear;

  let bannerHTML = "";

  if (hasMeta) {
    bannerHTML += `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#1e40af;">
        ${meta.branch ? `<div><strong>Branch:</strong> ${escapeHTML(meta.branch)}</div>` : ""}
        ${meta.semester ? `<div><strong>Semester:</strong> ${escapeHTML(meta.semester)}</div>` : ""}
        ${meta.section ? `<div><strong>Section:</strong> ${escapeHTML(meta.section)}</div>` : ""}
        ${meta.academicYear ? `<div><strong>Academic Year:</strong> ${escapeHTML(meta.academicYear)}</div>` : ""}
      </div>`;
  }

  dedupBannerSlot.innerHTML = bannerHTML;

  // Group entries by day
  const byDay = new Map();
  for (const day of DAYS_OF_WEEK) byDay.set(day, []);
  for (const entry of parsedData.entries) {
    if (!byDay.has(entry.day_of_week)) byDay.set(entry.day_of_week, []);
    byDay.get(entry.day_of_week).push(entry);
  }

  verificationDaysList.innerHTML = DAYS_OF_WEEK.map((day) => {
    const list = byDay.get(day) || [];
    if (!list.length) return "";

    return `
      <div class="day-section">
        <div class="day-section-title">
          <span>${day}</span>
          <span style="font-size:12px;font-weight:500;color:#64748b;">${list.length} class${list.length > 1 ? "es" : ""}</span>
        </div>
        <div>
          ${list
            .map((entry, idx) => {
              const globalIdx = parsedData.entries.indexOf(entry);
              const needsReview = entry.needsReview;

              return `
                <div class="entry-row-grid ${needsReview ? "needs-review-row" : ""}" data-entry-idx="${globalIdx}" style="${needsReview ? "background:#fffbeb;border:1px solid #fde68a;" : ""}">
                  <div>
                    <select class="field-day" title="Day">
                      ${DAYS_OF_WEEK.map((d) => `<option value="${d}" ${d === entry.day_of_week ? "selected" : ""}>${d.slice(0, 3)}</option>`).join("")}
                    </select>
                  </div>
                  <div>
                    <input type="text" class="field-name" value="${escapeHTML(entry.subject_name)}" placeholder="Subject Name" title="Subject Name" />
                    ${needsReview ? `<span style="font-size:10px;color:#d97706;font-weight:600;">⚠️ Needs Review</span>` : ""}
                  </div>
                  <div>
                    <input type="text" class="field-code" value="${escapeHTML(entry.subject_code || "")}" placeholder="Code (e.g. DBMS)" title="Subject Code" />
                  </div>
                  <div>
                    <select class="field-type" title="Type">
                      <option value="THEORY" ${entry.subject_type === "THEORY" ? "selected" : ""}>Theory</option>
                      <option value="LAB" ${entry.subject_type === "LAB" ? "selected" : ""}>Lab</option>
                      <option value="TUTORIAL" ${entry.subject_type === "TUTORIAL" ? "selected" : ""}>Tutorial</option>
                      <option value="OTHER" ${entry.subject_type === "OTHER" ? "selected" : ""}>Other</option>
                    </select>
                  </div>
                  <div>
                    <select class="field-periods" title="Period Count / Duration">
                      <option value="1" ${entry.period_count === 1 ? "selected" : ""}>1 period</option>
                      <option value="2" ${entry.period_count === 2 ? "selected" : ""}>2 periods</option>
                      <option value="3" ${entry.period_count === 3 ? "selected" : ""}>3 periods</option>
                      <option value="4" ${entry.period_count === 4 ? "selected" : ""}>4 periods</option>
                    </select>
                  </div>
                  <div>
                    <button class="btn btn-ghost btn-sm remove-entry-btn" style="color:#ef4444;" title="Delete">✕</button>
                  </div>
                </div>`;
            })
            .join("")}
        </div>
      </div>`;
  }).join("");

  verificationDaysList.querySelectorAll(".entry-row-grid").forEach((row) => {
    const idx = parseInt(row.dataset.entryIdx, 10);
    const item = parsedData.entries[idx];
    if (!item) return;

    row.querySelector(".field-day").addEventListener("change", (e) => {
      item.day_of_week = e.target.value;
      renderVerificationForm();
    });
    row.querySelector(".field-name").addEventListener("input", (e) => { item.subject_name = e.target.value; });
    row.querySelector(".field-code").addEventListener("input", (e) => { item.subject_code = e.target.value; });
    row.querySelector(".field-type").addEventListener("change", (e) => { item.subject_type = e.target.value; });
    row.querySelector(".field-periods").addEventListener("change", (e) => { item.period_count = parseInt(e.target.value, 10); });
    row.querySelector(".remove-entry-btn").addEventListener("click", () => {
      parsedData.entries.splice(idx, 1);
      renderVerificationForm();
    });
  });
}

/* ---------------- Debug Grid View Modal ---------------- */

function wireDebugModal() {
  showDebugGridBtn.addEventListener("click", drawExtractionDebugGrid);
  closeDebugModalBtn.addEventListener("click", () => debugModal.classList.remove("open"));
  debugModal.addEventListener("click", (e) => { if (e.target === debugModal) debugModal.classList.remove("open"); });
}

function drawExtractionDebugGrid() {
  if (!currentFile || !parsedData?.detectedGrid) return;
  debugModal.classList.add("open");

  const grid = parsedData.detectedGrid;
  const img = new Image();
  const url = URL.createObjectURL(currentFile);

  img.onload = () => {
    URL.revokeObjectURL(url);
    debugCanvas.width = img.naturalWidth || img.width;
    debugCanvas.height = img.naturalHeight || img.height;
    const ctx = debugCanvas.getContext("2d");

    // 1. Draw raw image
    ctx.drawImage(img, 0, 0);

    // 2. Draw Table Region Box (Red)
    if (grid.tableRegion) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 4;
      ctx.strokeRect(grid.tableRegion.minX, grid.tableRegion.minY, grid.tableRegion.width, grid.tableRegion.height);
    }

    // 3. Draw Period Column Lines (Blue Dashed)
    if (grid.periodColumns) {
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      for (const col of grid.periodColumns) {
        ctx.beginPath();
        ctx.moveTo(col.x0, 0);
        ctx.lineTo(col.x0, debugCanvas.height);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 4. Draw Day Row Lines (Green Solid)
    if (grid.dayRows) {
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      for (const row of grid.dayRows) {
        ctx.beginPath();
        ctx.moveTo(0, row.y0);
        ctx.lineTo(debugCanvas.width, row.y0);
        ctx.stroke();
      }
    }

    // 5. Draw Reconstructed Cell Boxes (Yellow Overlay + Text Labels)
    if (grid.gridCells) {
      for (const cell of grid.gridCells) {
        ctx.fillStyle = cell.needsReview ? "rgba(245, 158, 11, 0.35)" : "rgba(253, 224, 71, 0.25)";
        ctx.strokeStyle = cell.needsReview ? "#d97706" : "#eab308";
        ctx.lineWidth = 2;

        const w = cell.bbox.x1 - cell.bbox.x0;
        const h = cell.bbox.y1 - cell.bbox.y0;
        ctx.fillRect(cell.bbox.x0, cell.bbox.y0, w, h);
        ctx.strokeRect(cell.bbox.x0, cell.bbox.y0, w, h);

        // Find corresponding entry text
        const entry = parsedData.entries.find(
          (e) => e.day_of_week === cell.day_of_week && e.period_number === cell.startPeriod
        );

        if (entry) {
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 14px sans-serif";
          const label = `${entry.subject_name} (${entry.period_count}P)`;
          ctx.fillText(label, cell.bbox.x0 + 4, cell.bbox.y0 + 18);
        }
      }
    }
  };

  img.src = url;
}

async function saveConfirmedTimetable() {
  if (!parsedData || !parsedData.entries || !parsedData.entries.length) {
    showToast("Please add at least one timetable entry.", "info");
    return;
  }

  const subjectsToCreateMap = new Map();
  for (const entry of parsedData.entries) {
    const name = entry.subject_name.trim();
    if (!name) continue;
    const key = name.toLowerCase();

    if (!subjectsToCreateMap.has(key)) {
      subjectsToCreateMap.set(key, {
        subject_name: name,
        subject_code: entry.subject_code || "",
        subject_type: entry.subject_type || "THEORY",
        weekly_periods: entry.period_count || 1,
      });
    } else {
      const sub = subjectsToCreateMap.get(key);
      sub.weekly_periods += entry.period_count || 1;
    }
  }

  const subjectsToCreate = Array.from(subjectsToCreateMap.values());

  await withLoading(confirmBtnBottom, "Saving Timetable...", async () => {
    try {
      await saveTimetableData(currentUser.id, {
        periods: parsedData.periods || getDefaultPeriods(),
        subjects: subjectsToCreate,
        entries: parsedData.entries,
      });

      showToast("Timetable saved and subjects created successfully!", "success");
      await checkExistingTimetable();
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });
}

/* ---------------- Render Grid View ---------------- */

function renderGrid(entries) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const maxPeriods = 7;

  let gridHTML = "";
  for (let pNum = 1; pNum <= maxPeriods; pNum++) {
    const timeLabel = `Period ${pNum}`;
    gridHTML += `
      <tr>
        <td style="font-weight:600;color:#64748b;">${timeLabel}</td>
        ${days
          .map((day) => {
            const dayEntries = entries.filter((e) => e.day_of_week === day);
            const classItem = dayEntries[pNum - 1];

            if (!classItem) return `<td>—</td>`;

            const sub = classItem.subject || { subject_name: "Class" };
            const typeClass = classItem.period_count > 1 ? "type-lab" : "type-theory";

            return `
              <td>
                <div class="cell-subject-name">${escapeHTML(sub.subject_name)}</div>
                <span class="cell-type-tag ${typeClass}">
                  ${classItem.period_count > 1 ? `${classItem.period_count} periods` : (sub.subject_type || "Theory")}
                </span>
              </td>`;
          })
          .join("")}
      </tr>`;
  }

  gridBody.innerHTML = gridHTML;

  mobileList.innerHTML = days
    .map((day) => {
      const dayEntries = entries.filter((e) => e.day_of_week === day);
      if (!dayEntries.length) return "";

      return `
        <div class="mobile-day-card">
          <div class="mobile-day-header">${day}</div>
          <div>
            ${dayEntries
              .map((e) => {
                const sub = e.subject || { subject_name: "Class" };
                return `
                  <div class="mobile-class-item">
                    <div>
                      <div style="font-weight:600;">${escapeHTML(sub.subject_name)}</div>
                      <div style="font-size:12px;color:#64748b;">${e.start_time || ""} - ${e.end_time || ""}</div>
                    </div>
                    <span class="cell-type-tag ${e.period_count > 1 ? "type-lab" : "type-theory"}">
                      ${e.period_count > 1 ? `${e.period_count} Periods` : "1 Period"}
                    </span>
                  </div>`;
              })
              .join("")}
          </div>
        </div>`;
    })
    .join("");
}
