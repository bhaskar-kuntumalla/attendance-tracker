// ============================================================
// landing.js — shared logic for the two PUBLIC pages
// (index.html and how-it-works.html). These pages don't use the
// authenticated app shell from nav.js (no sidebar/bottom-nav —
// they must render for signed-out visitors), so this file plays
// the same "one place, not copy-pasted" role that nav.js plays
// for the protected pages.
//
// Responsibilities:
//   - inject a lightweight public header (brand + nav + auth CTA)
//   - detect Supabase auth state once
//   - toggle every [data-guest-only] / [data-auth-only] element
//   - optionally fill a first-name greeting for signed-in visitors
// ============================================================
import { supabase } from "./supabase.js";
import { initLogoutButton } from "./utils.js";
import { getProfile } from "./data.js";

function headerHTML() {
  return `
    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand site-brand" href="index.html"><span class="dot"></span>Attendance</a>
        <nav class="site-nav">
          <a href="index.html">Home</a>
          <a href="how-it-works.html">How It Works</a>
        </nav>
        <div class="site-header-cta">
          <div class="header-cta" data-guest-only>
            <a class="btn btn-secondary btn-sm" href="login.html">Log In</a>
            <a class="btn btn-primary btn-sm" href="signup.html">Create Account</a>
          </div>
          <div class="header-cta" data-auth-only style="display:none;">
            <a class="btn btn-secondary btn-sm" href="dashboard.html">Dashboard</a>
            <button class="btn btn-ghost btn-sm" data-logout>Logout</button>
          </div>
        </div>
      </div>
    </header>`;
}

function injectPublicHeader() {
  const slot = document.getElementById("public-header-slot");
  if (slot) slot.outerHTML = headerHTML();
}

// Call once at the top of every public page's <body>.
// Expects a mount point <div id="public-header-slot"></div>.
// Pass greetingNameEl (an element id) if the page has a spot to
// print the signed-in visitor's first name.
export async function initPublicPage({ greetingNameEl } = {}) {
  injectPublicHeader();
  initLogoutButton();

  let isAuthed = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    isAuthed = !!session;

    document.querySelectorAll("[data-guest-only]").forEach((el) => {
      el.style.display = isAuthed ? "none" : "";
    });
    document.querySelectorAll("[data-auth-only]").forEach((el) => {
      el.style.display = isAuthed ? "" : "none";
    });
    document.body.classList.toggle("is-authed", isAuthed);
    document.body.classList.toggle("is-guest", !isAuthed);

    if (isAuthed && greetingNameEl && session?.user) {
      const el = document.getElementById(greetingNameEl);
      if (el) {
        try {
          const profile = await getProfile(session.user.id);
          el.textContent = profile.full_name?.split(" ")[0] || "there";
        } catch {
          el.textContent = "there"; // profile fetch failing shouldn't block a marketing page
        }
      }
    }
  } catch {
    // If the session check itself fails (offline, etc.), fall back to
    // the signed-out view — it's always usable and never blocks the page.
  }
  return isAuthed;
}
