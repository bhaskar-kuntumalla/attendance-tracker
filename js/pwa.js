// ============================================================
// js/pwa.js — single place for all PWA behaviour:
//   - service worker registration + update handling
//   - "Install App" button (native prompt on Chrome/Edge/Android,
//     instructional fallback on iOS Safari)
//   - standalone-mode detection (hides install UI once installed)
//   - online/offline indicator
//
// Import once per page and call initPWA(). Nothing else needs to
// change per-page — this file injects its own UI elements.
// ============================================================

let deferredInstallPrompt = null;

/* ---------------- standalone detection ---------------- */

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    window.navigator.standalone === true // iOS Safari
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/* ---------------- service worker registration ---------------- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js");

      // A new service worker was found and finished installing —
      // it's waiting because an old one still controls the page.
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateToast(registration);
          }
        });
      });
    } catch (err) {
      console.warn("[PWA] Service worker registration failed:", err);
    }
  });

  // Reload once the new service worker takes control, so the user
  // gets the freshly-cached app shell instead of a stale mix.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function showUpdateToast(registration) {
  let bar = document.getElementById("pwa-update-bar");
  if (bar) return; // already showing
  bar = document.createElement("div");
  bar.id = "pwa-update-bar";
  bar.className = "pwa-update-bar";
  bar.innerHTML = `
    <span>A new version is available.</span>
    <button type="button" class="pwa-update-btn">Refresh</button>
  `;
  document.body.appendChild(bar);
  bar.querySelector(".pwa-update-btn").addEventListener("click", () => {
    registration.waiting?.postMessage("SKIP_WAITING");
    bar.remove();
  });
}

/* ---------------- offline indicator ---------------- */

function setupOfflineIndicator() {
  let banner = document.getElementById("pwa-offline-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "pwa-offline-banner";
    banner.className = "pwa-offline-banner";
    banner.textContent = "You're offline — some data may be out of date.";
    document.body.appendChild(banner);
  }

  const update = () => {
    banner.classList.toggle("show", !navigator.onLine);
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

/* ---------------- install button ---------------- */

function createInstallButton() {
  let btn = document.getElementById("pwa-install-btn");
  if (btn) return btn;
  btn = document.createElement("button");
  btn.id = "pwa-install-btn";
  btn.type = "button";
  btn.className = "pwa-install-btn";
  btn.style.display = "none";
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>
    </svg>
    <span>Install App</span>
  `;
  document.body.appendChild(btn);
  return btn;
}

function setupInstallPrompt() {
  // Already installed / running standalone — never show install UI.
  if (isStandalone()) return;

  const btn = createInstallButton();

  // Chrome / Edge / Android: browser fires this when install criteria are met.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    btn.style.display = "inline-flex";
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    btn.style.display = "none";
  });

  btn.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      btn.style.display = "none";
      return;
    }

    // Fallback for browsers without beforeinstallprompt support (iOS Safari,
    // and desktop Safari/Firefox which don't support install at all).
    if (isIOS()) {
      showFallbackTip("Tap the Share icon, then \"Add to Home Screen\".");
    } else {
      showFallbackTip("Open this site's menu in your browser and choose \"Install app\".");
    }
  });

  // iOS never fires beforeinstallprompt — still show the button so
  // users can get the manual instructions.
  if (isIOS() && !isStandalone()) {
    btn.style.display = "inline-flex";
  }
}

function showFallbackTip(message) {
  let tip = document.getElementById("pwa-fallback-tip");
  if (tip) {
    tip.remove();
  }
  tip = document.createElement("div");
  tip.id = "pwa-fallback-tip";
  tip.className = "pwa-fallback-tip";
  tip.textContent = message;
  document.body.appendChild(tip);
  requestAnimationFrame(() => tip.classList.add("show"));
  setTimeout(() => {
    tip.classList.remove("show");
    setTimeout(() => tip.remove(), 250);
  }, 4500);
}

/* ---------------- entry point ---------------- */

export function initPWA() {
  registerServiceWorker();
  setupInstallPrompt();
  setupOfflineIndicator();
}
