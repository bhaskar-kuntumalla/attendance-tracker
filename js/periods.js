// ============================================================
// periods.js — Custom Period Timings Controller
// ============================================================

import { requireAuth, showToast, friendlyError, withLoading, escapeHTML } from "./utils.js";
import { getPeriods, savePeriods } from "./data.js";
import { getDefaultPeriods } from "./timetable-parser.js";

let currentUser = null;
let periodsCache = [];

const listEl = document.getElementById("period-list");
const saveBtn = document.getElementById("save-periods-btn");
const addBtn = document.getElementById("add-period-btn");
const resetDefaultsBtn = document.getElementById("reset-defaults-btn");

export async function initPeriods() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  wireEvents();
  await loadPeriods();
}

async function loadPeriods() {
  try {
    const fetched = await getPeriods(currentUser.id);
    if (fetched && fetched.length > 0) {
      periodsCache = fetched;
    } else {
      periodsCache = getDefaultPeriods();
    }
    renderList();
  } catch (err) {
    showToast(friendlyError(err), "error");
  }
}

function wireEvents() {
  addBtn.addEventListener("click", () => {
    const nextNum = periodsCache.length + 1;
    periodsCache.push({
      period_number: nextNum,
      name: `Period ${nextNum}`,
      start_time: "16:00",
      end_time: "17:00",
      is_break: false,
    });
    renderList();
  });

  resetDefaultsBtn.addEventListener("click", () => {
    periodsCache = getDefaultPeriods();
    renderList();
    showToast("Reset to default college period timings.", "info");
  });

  saveBtn.addEventListener("click", saveAllPeriods);
}

function renderList() {
  listEl.innerHTML = periodsCache
    .map((p, idx) => {
      return `
        <div class="period-item-card ${p.is_break ? "is-break" : ""}" data-period-idx="${idx}">
          <div class="period-num-badge">P${p.period_number || idx + 1}</div>
          <div>
            <label class="text-xs" style="color:#64748b;">Period Name</label>
            <input type="text" class="field-name" value="${escapeHTML(p.name)}" style="width:100%;padding:6px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;" />
          </div>
          <div>
            <label class="text-xs" style="color:#64748b;">Start Time</label>
            <input type="time" class="field-start" value="${p.start_time || "09:00"}" style="width:100%;padding:6px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;" />
          </div>
          <div>
            <label class="text-xs" style="color:#64748b;">End Time</label>
            <input type="time" class="field-end" value="${p.end_time || "10:00"}" style="width:100%;padding:6px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;" />
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding-top:16px;">
            <input type="checkbox" class="field-break" id="break-${idx}" ${p.is_break ? "checked" : ""} />
            <label for="break-${idx}" class="text-xs" style="cursor:pointer;">Break / Lunch</label>
          </div>
          <div style="padding-top:14px;">
            <button class="btn btn-ghost btn-sm remove-period-btn" style="color:#ef4444;" title="Delete">✕</button>
          </div>
        </div>`;
    })
    .join("");

  listEl.querySelectorAll(".period-item-card").forEach((card) => {
    const idx = parseInt(card.dataset.periodIdx, 10);
    const item = periodsCache[idx];
    if (!item) return;

    card.querySelector(".field-name").addEventListener("input", (e) => { item.name = e.target.value; });
    card.querySelector(".field-start").addEventListener("change", (e) => { item.start_time = e.target.value; });
    card.querySelector(".field-end").addEventListener("change", (e) => { item.end_time = e.target.value; });
    card.querySelector(".field-break").addEventListener("change", (e) => {
      item.is_break = e.target.checked;
      renderList();
    });
    card.querySelector(".remove-period-btn").addEventListener("click", () => {
      periodsCache.splice(idx, 1);
      renderList();
    });
  });
}

async function saveAllPeriods() {
  await withLoading(saveBtn, "Saving Settings...", async () => {
    try {
      await savePeriods(currentUser.id, periodsCache);
      showToast("Period timings saved successfully!", "success");
      await loadPeriods();
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });
}
