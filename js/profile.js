// ============================================================
// profile.js
// ============================================================
import { supabase } from "./supabase.js";
import { requireAuth, showToast, friendlyError, withLoading } from "./utils.js";
import { getProfile, updateProfile } from "./data.js";

export async function initProfile() {
  const user = await requireAuth();
  if (!user) return;

  const form = document.getElementById("profile-form");

  try {
    const profile = await getProfile(user.id);
    document.getElementById("avatar-initial").textContent = (profile.full_name || "?").trim().charAt(0).toUpperCase();
    document.getElementById("email-readonly").textContent = profile.email || user.email;
    form.fullName.value = profile.full_name || "";
    form.rollNumber.value = profile.roll_number || "";
    form.semester.value = profile.semester || "";
    if (form.academicYear) form.academicYear.value = profile.academic_year || "";
    form.attendanceTarget.value = profile.attendance_target || 75;
    form.style.display = "block";
    document.getElementById("profile-skeleton").style.display = "none";
  } catch (error) {
    showToast(friendlyError(error), "error");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.querySelectorAll(".field").forEach((f) => f.classList.remove("has-error"));

    const fullName = form.fullName.value.trim();
    const rollNumber = form.rollNumber.value.trim();
    const semester = form.semester.value.trim();
    const academicYear = form.academicYear ? form.academicYear.value.trim() : "";
    const target = parseFloat(form.attendanceTarget.value);

    let hasError = false;
    if (!fullName) { fieldFail(form.fullName, "Full name is required."); hasError = true; }
    if (!rollNumber) { fieldFail(form.rollNumber, "Roll number is required."); hasError = true; }
    if (!target || target <= 0 || target > 100) { fieldFail(form.attendanceTarget, "Target must be between 1 and 100."); hasError = true; }
    if (hasError) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    await withLoading(submitBtn, "Saving...", async () => {
      try {
        await updateProfile(user.id, {
          full_name: fullName,
          roll_number: rollNumber,
          semester,
          academic_year: academicYear,
          attendance_target: target,
        });
        document.getElementById("avatar-initial").textContent = fullName.charAt(0).toUpperCase();
        showToast("Profile updated. All calculations now use the new target.", "success");
      } catch (error) {
        showToast(friendlyError(error), "error");
      }
    });
  });

  initChangePassword();
}

function fieldFail(input, message) {
  const field = input.closest(".field");
  field.classList.add("has-error");
  field.querySelector(".field-error").textContent = message;
}

function initChangePassword() {
  const form = document.getElementById("password-form");
  if (!form) return;

  const banner = form.querySelector(".form-error-banner");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.querySelectorAll(".field").forEach((f) => f.classList.remove("has-error"));
    if (banner) banner.classList.remove("show");

    const newPassword = form.newPassword.value;
    const confirmNewPassword = form.confirmNewPassword.value;

    let hasError = false;
    if (newPassword.length < 6) { fieldFail(form.newPassword, "Password must be at least 6 characters."); hasError = true; }
    if (newPassword !== confirmNewPassword) { fieldFail(form.confirmNewPassword, "Passwords do not match."); hasError = true; }
    if (hasError) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    await withLoading(submitBtn, "Updating...", async () => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        if (banner) {
          banner.textContent = friendlyError(error);
          banner.classList.add("show");
        } else {
          showToast(friendlyError(error), "error");
        }
        return;
      }
      form.reset();
      showToast("Password updated successfully.", "success");
    });
  });
}
