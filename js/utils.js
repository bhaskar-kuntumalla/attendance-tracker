// ============================================================
// utils.js — shared helpers used across all pages
// ============================================================
import { supabase } from "./supabase.js";

/* ---------------- Auth guards ---------------- */

// Call on every protected page. Redirects to login.html if not authenticated.
// Returns the current session's user, or null (after redirecting).
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  return session.user;
}

// Call on login.html / signup.html. Redirects to dashboard if already logged in.
export async function redirectIfAuthed() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.href = "dashboard.html";
}

/* ---------------- Attendance math ----------------
   All calculations use PERIODS, never a raw row count.
   present / total are period sums, target is a percentage (e.g. 75). */

// Round to 1 decimal place. Guards against NaN / Infinity.
export function pct(present, total) {
  if (!total || total <= 0) return null; // "no attendance recorded"
  const value = (present / total) * 100;
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

export function formatPct(present, total) {
  const p = pct(present, total);
  return p === null ? "No attendance recorded" : `${p}%`;
}

// SAFE / NEEDS ATTENTION / CRITICAL, based on percentage vs target.
export function attendanceStatus(present, total, target) {
  const p = pct(present, total);
  if (p === null) return { level: "unknown", label: "No data" };
  if (p >= target) return { level: "safe", label: "SAFE" };
  if (p >= 50) return { level: "warning", label: "NEEDS ATTENTION" };
  return { level: "critical", label: "CRITICAL" };
}

// How many consecutive future periods (all attended) are needed to reach target.
// Solve for smallest integer x >= 0 such that (present + x) / (total + x) >= target/100
export function periodsToReachTarget(present, total, target) {
  const T = target / 100;
  if (T >= 1) return Infinity; // 100% target can never be "reached" once any absence exists
  if (total > 0 && present / total >= T) return 0; // already at/above target
  const x = (T * total - present) / (1 - T);
  return Math.max(0, Math.ceil(x - 1e-9));
}

// How many future periods can be missed (counted as absent, added to total)
// while staying at or above target. Solve for largest integer x >= 0 such that
// present / (total + x) >= target/100
export function periodsCanMiss(present, total, target) {
  const T = target / 100;
  if (T <= 0) return Infinity;
  if (total > 0 && present / total < T) return 0; // already below target
  const x = present / T - total;
  return Math.max(0, Math.floor(x + 1e-9));
}

// Simulate the effect of the next single period being present or absent.
export function simulateNextPeriod(present, total, target) {
  const current = pct(present, total);
  const ifPresent = pct(present + 1, total + 1);
  const ifAbsent = pct(present, total + 1);
  return {
    current,
    ifPresent,
    ifAbsent,
    canMiss: periodsCanMiss(present, total, target),
    needToAttend: periodsToReachTarget(present, total, target),
  };
}

/* ---------------- Formatting ---------------- */

// Escapes user-entered text before it's dropped into innerHTML.
export function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export function formatDate(dateStr) {
  // "2026-08-09" -> "09 Aug 2026"
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

/* ---------------- UI helpers ---------------- */

export function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// Disables a button and swaps its label while an async action runs.
export async function withLoading(button, loadingText, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// Turns raw Supabase/Postgres errors into friendly, non-technical messages.
export function friendlyError(error) {
  if (!error) return "Something went wrong. Please try again.";
  const msg = (error.message || "").toLowerCase();

  if (msg.includes("invalid login credentials")) return "Incorrect email or password.";
  if (msg.includes("user already registered")) return "An account with this email already exists.";
  if (msg.includes("duplicate key") && msg.includes("attendance"))
    return "Attendance for this subject and date is already saved. It's been updated instead.";
  if (msg.includes("duplicate key")) return "That record already exists.";
  if (msg.includes("network") || msg.includes("fetch")) return "Network error. Check your connection and try again.";
  if (msg.includes("jwt") || msg.includes("session")) return "Your session expired. Please log in again.";
  if (msg.includes("row-level security")) return "You don't have permission to do that.";

  return "Something went wrong. Please try again.";
}

// Wires every logout control on the page (desktop sidebar + mobile topbar both use data-logout).
export function initLogoutButton() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase.auth.signOut();
      window.location.href = "login.html";
    });
  });
}

// Highlights the current page in the nav (desktop sidebar + mobile bottom bar).
export function markActiveNav() {
  const page = window.location.pathname.split("/").pop() || "dashboard.html";
  document.querySelectorAll("[data-nav-link]").forEach((el) => {
    if (el.getAttribute("href") === page) el.classList.add("active");
  });
}
