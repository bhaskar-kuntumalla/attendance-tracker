// ============================================================
// auth.js — signup + login page logic
// ============================================================
import { supabase, DEFAULT_ATTENDANCE_TARGET } from "./supabase.js";
import { redirectIfAuthed, friendlyError, withLoading, showToast } from "./utils.js";

function setFieldError(fieldId, message) {
  const field = document.getElementById(fieldId).closest(".field");
  field.classList.add("has-error");
  field.querySelector(".field-error").textContent = message;
}

function clearFieldErrors(form) {
  form.querySelectorAll(".field").forEach((f) => f.classList.remove("has-error"));
  const banner = form.querySelector(".form-error-banner");
  if (banner) banner.classList.remove("show");
}

function showFormError(form, message) {
  const banner = form.querySelector(".form-error-banner");
  if (banner) {
    banner.textContent = message;
    banner.classList.add("show");
  } else {
    showToast(message, "error");
  }
}

/* ---------------- Signup ---------------- */

export function initSignupForm() {
  redirectIfAuthed();
  const form = document.getElementById("signup-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);

    const fullName = form.fullName.value.trim();
    const rollNumber = form.rollNumber.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    const semester = form.semester.value.trim();
    const target = parseFloat(form.attendanceTarget.value) || DEFAULT_ATTENDANCE_TARGET;

    let hasError = false;
    if (!fullName) { setFieldError("fullName", "Full name is required."); hasError = true; }
    if (!rollNumber) { setFieldError("rollNumber", "Roll number is required."); hasError = true; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setFieldError("email", "Enter a valid email address."); hasError = true; }
    if (password.length < 6) { setFieldError("password", "Password must be at least 6 characters."); hasError = true; }
    if (password !== confirmPassword) { setFieldError("confirmPassword", "Passwords do not match."); hasError = true; }
    if (target <= 0 || target > 100) { setFieldError("attendanceTarget", "Target must be between 1 and 100."); hasError = true; }
    if (hasError) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    await withLoading(submitBtn, "Creating account...", async () => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            roll_number: rollNumber,
            semester,
            attendance_target: target,
          },
        },
      });

      if (error) {
        showFormError(form, friendlyError(error));
        return;
      }

      // If email confirmation is required, there will be no active session yet.
      if (!data.session) {
        showToast("Account created! Check your email to confirm, then log in.", "success");
        setTimeout(() => (window.location.href = "login.html"), 1600);
        return;
      }

      showToast("Account created!", "success");
      window.location.href = "dashboard.html";
    });
  });
}

/* ---------------- Login ---------------- */

export function initLoginForm() {
  redirectIfAuthed();
  const form = document.getElementById("login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);

    const email = form.email.value.trim();
    const password = form.password.value;

    let hasError = false;
    if (!/^\S+@\S+\.\S+$/.test(email)) { setFieldError("email", "Enter a valid email address."); hasError = true; }
    if (!password) { setFieldError("password", "Password is required."); hasError = true; }
    if (hasError) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    await withLoading(submitBtn, "Logging in...", async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        showFormError(form, friendlyError(error));
        return;
      }
      window.location.href = "dashboard.html";
    });
  });
}
