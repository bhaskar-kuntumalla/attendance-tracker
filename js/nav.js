// ============================================================
// nav.js — injects the sidebar / topbar / bottom-nav shell
// Keeps nav markup + icons in one place instead of duplicated
// across HTML files. Active link is set by utils.markActiveNav().
// ============================================================

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  timetable: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>',
  subjects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  attendance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="13" y="8" width="3" height="10"/><rect x="19" y="5" width="0" height="0"/><rect x="17" y="5" width="3" height="13"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2.3 3.2"/><path d="M12 16.5h.01"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
};

const LINKS = [
  { href: "dashboard.html", label: "Dashboard", icon: "dashboard" },
  { href: "timetable.html", label: "Timetable", icon: "timetable" },
  { href: "subjects.html", label: "Subjects", icon: "subjects" },
  { href: "attendance.html", label: "Attendance", icon: "attendance" },
  { href: "analytics.html", label: "Analytics", icon: "analytics" },
  { href: "profile.html", label: "Profile", icon: "profile" },
  { href: "how-it-works.html", label: "How It Works", icon: "guide" },
];

function sidebarHTML() {
  const items = LINKS.map(
    (l) => `<li><a href="${l.href}" data-nav-link>${ICONS[l.icon]}${l.label}</a></li>`
  ).join("");
  return `
    <aside class="sidebar">
      <div class="brand"><span class="dot"></span>Attendance</div>
      <ul class="nav-list">${items}</ul>
      <div class="sidebar-footer">
        <button class="btn btn-secondary btn-block btn-sm" data-logout>${ICONS.logout} Logout</button>
      </div>
    </aside>`;
}

function topbarHTML() {
  return `
    <div class="topbar">
      <div class="brand"><span class="dot"></span>Attendance</div>
      <button class="btn btn-ghost btn-icon" data-logout title="Logout">${ICONS.logout}</button>
    </div>`;
}

function bottomNavHTML() {
  const items = LINKS.map(
    (l) => `<a href="${l.href}" data-nav-link>${ICONS[l.icon]}<span>${l.label}</span></a>`
  ).join("");
  return `<nav class="bottom-nav">${items}</nav>`;
}

// Call once at the top of every protected page's <body>.
// Expects three empty mount points: #sidebar-slot, #topbar-slot, #bottomnav-slot
export function injectShell() {
  const sidebarSlot = document.getElementById("sidebar-slot");
  const topbarSlot = document.getElementById("topbar-slot");
  const bottomSlot = document.getElementById("bottomnav-slot");
  if (sidebarSlot) sidebarSlot.outerHTML = sidebarHTML();
  if (topbarSlot) topbarSlot.outerHTML = topbarHTML();
  if (bottomSlot) bottomSlot.outerHTML = bottomNavHTML();
  // Lets pwa.js's floating install button/toasts sit above the
  // bottom tab bar on pages that have this shell (see style.css).
  document.body.classList.add("has-app-shell");
}
