/**
 * pwa.js — Service Worker registration, install prompt, update banner
 */

let deferredPrompt = null;
let registration   = null;

export function initPWA() {
  registerSW();
  setupInstallBanner();
}

// ---- SERVICE WORKER ----

function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/service-worker.js')
    .then((reg) => {
      registration = reg;

      // Detect new SW waiting
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });

      // If SW already waiting on page load
      if (reg.waiting) showUpdateBanner();
    })
    .catch((err) => console.warn('SW registration failed:', err));

  // Reload after SW activates
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) { refreshing = true; window.location.reload(); }
  });
}

// ---- UPDATE BANNER ----

function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.classList.add('visible');
}

export function applyUpdate() {
  if (registration && registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
}

export function dismissUpdate() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.classList.remove('visible');
}

// ---- INSTALL BANNER ----

function setupInstallBanner() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Only show if not already installed
    if (!window.matchMedia('(display-mode: standalone)').matches) {
      const banner = document.getElementById('install-banner');
      if (banner) banner.classList.add('visible');
    }
  });

  window.addEventListener('appinstalled', () => {
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.remove('visible');
    deferredPrompt = null;
  });
}

export function triggerInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => {
    deferredPrompt = null;
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.remove('visible');
  });
}

export function dismissInstall() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.remove('visible');
}
