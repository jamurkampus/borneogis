// pwa.js - PWA Install & Update Manager for BorneoGIS
const PWAManager = (() => {
  let deferredPrompt = null;
  let currentVersion = null;
  let registration = null;

  async function init() {
    await registerServiceWorker();
    setupInstallPrompt();
    getVersion();
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      registration = await navigator.serviceWorker.register('/service-worker.js');

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateNotification();
          }
        });
      });

      // Listen for controller change (after update)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });

      // Periodic update check every 30 minutes
      setInterval(() => registration.update(), 30 * 60 * 1000);

    } catch (err) {
      console.warn('Service Worker registration failed:', err);
    }
  }

  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      showInstallBanner();
    });

    window.addEventListener('appinstalled', () => {
      hideInstallBanner();
      deferredPrompt = null;
      App.showToast('BorneoGIS berhasil diinstall!', 'success');
    });
  }

  function showInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (banner) {
      banner.style.display = 'flex';
      setTimeout(() => banner.classList.add('visible'), 100);
    }
  }

  function hideInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (banner) {
      banner.classList.remove('visible');
      setTimeout(() => banner.style.display = 'none', 300);
    }
  }

  async function promptInstall() {
    if (!deferredPrompt) {
      // Already installed or not supported
      if (window.matchMedia('(display-mode: standalone)').matches) {
        App.showToast('Aplikasi sudah terinstall', 'info');
      } else {
        App.showToast('Browser tidak mendukung instalasi PWA', 'warning');
      }
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      App.showToast('Menginstall BorneoGIS...', 'info');
    }
    deferredPrompt = null;
    hideInstallBanner();
  }

  function showUpdateNotification() {
    const modal = document.getElementById('update-modal');
    if (!modal) return;

    // Get release notes from SW
    navigator.serviceWorker.controller?.postMessage('GET_VERSION');

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data.type === 'VERSION') {
        const notes = document.getElementById('update-notes');
        if (notes && e.data.releaseNotes) {
          notes.innerHTML = e.data.releaseNotes.map(n => `<li>${n}</li>`).join('');
        }
      }
    });

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 50);
  }

  function applyUpdate() {
    if (registration && registration.waiting) {
      registration.waiting.postMessage('SKIP_WAITING');
    }
    const modal = document.getElementById('update-modal');
    if (modal) modal.classList.remove('visible');
  }

  function dismissUpdate() {
    const modal = document.getElementById('update-modal');
    if (modal) {
      modal.classList.remove('visible');
      setTimeout(() => modal.style.display = 'none', 300);
    }
  }

  function getVersion() {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('GET_VERSION');
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data.type === 'VERSION') {
          currentVersion = e.data.version;
          const el = document.getElementById('app-version');
          if (el) el.textContent = e.data.version;
        }
      });
    }
  }

  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function checkOnline() {
    return navigator.onLine;
  }

  function setupOfflineIndicator() {
    const update = () => {
      const indicator = document.getElementById('offline-indicator');
      if (indicator) {
        indicator.style.display = navigator.onLine ? 'none' : 'flex';
      }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  return { init, promptInstall, applyUpdate, dismissUpdate, isInstalled, checkOnline, setupOfflineIndicator };
})();

window.PWAManager = PWAManager;
