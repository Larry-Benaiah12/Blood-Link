// BloodLink PWA: registers the service worker, offers "Install app"
// (Chrome / Edge / Android / Samsung Internet), shows Add-to-Home-Screen
// steps on iPhone & iPad (Safari has no install prompt), and tells the
// user when a new version is ready.
(() => {
  const DISMISS_KEY = "bl-install-dismissed-at";
  const DISMISS_DAYS = 7;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    window.navigator.standalone === true;

  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);

  // ---------- Always open the installed app on the landing page ----------
  // iOS "Add to Home Screen" saves whatever page was open (and some devices
  // reopen the last page used), so on the first page of each app launch we
  // jump to the landing page. Later navigation inside the app is untouched.
  const LAUNCH_KEY = "bl-app-launched";
  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return "1"; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  if (isStandalone() && !session.get(LAUNCH_KEY)) {
    session.set(LAUNCH_KEY, "1");
    const page = location.pathname.split("/").pop();
    if (page !== "" && page !== "index.html") {
      location.replace(new URL("index.html", document.baseURI).href);
      return;
    }
  }

  const recentlyDismissed = () => {
    const at = Number(store.get(DISMISS_KEY));
    return at && Date.now() - at < DISMISS_DAYS * 864e5;
  };

  // ---------- styles (kept here so every page gets them) ----------
  const css = `
  .pwa-banner{position:fixed;left:50%;bottom:16px;transform:translate(-50%,140%);z-index:9999;
    width:min(440px,calc(100% - 32px));display:flex;gap:12px;align-items:center;
    background:#fff;color:#1a1a1a;border:1px solid #f0dcd8;border-radius:16px;
    box-shadow:0 12px 32px rgba(122,20,20,.18);padding:12px 12px 12px 14px;
    font:inherit;transition:transform .35s cubic-bezier(.2,.8,.2,1)}
  .pwa-banner.show{transform:translate(-50%,0)}
  .pwa-banner img{width:44px;height:44px;border-radius:10px;flex:none}
  .pwa-banner .pwa-text{flex:1;min-width:0;font-size:.92rem;line-height:1.35}
  .pwa-banner strong{display:block;font-size:1rem}
  .pwa-banner .pwa-actions{display:flex;gap:6px;flex:none}
  .pwa-btn{border:0;border-radius:999px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}
  .pwa-btn-primary{background:#c62828;color:#fff}
  .pwa-btn-primary:hover{background:#9f1f1f}
  .pwa-btn-ghost{background:transparent;color:#6b5a57}
  .pwa-ios-steps{margin:6px 0 0;padding:0;list-style:none;font-size:.88rem}
  .pwa-ios-steps li{display:flex;align-items:center;gap:6px;margin-top:4px}
  .pwa-ios-steps svg{width:18px;height:18px;flex:none;color:#0a84ff}
  @media (prefers-reduced-motion:reduce){.pwa-banner{transition:none}}
  @media print{.pwa-banner{display:none}}`;

  function injectStyles() {
    if (document.getElementById("pwa-styles")) return;
    const s = document.createElement("style");
    s.id = "pwa-styles";
    s.textContent = css;
    document.head.append(s);
  }

  const iconUrl = new URL("assets/icons/icon-192.png", document.baseURI).href;

  function banner(html) {
    injectStyles();
    document.querySelector(".pwa-banner")?.remove();
    const el = document.createElement("div");
    el.className = "pwa-banner";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = html;
    document.body.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
    return el;
  }

  function hide(el) {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  }

  // ---------- Install: Chrome / Edge / Android ----------
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.querySelectorAll("[data-install-app]").forEach((b) => (b.hidden = false));
    if (!recentlyDismissed()) setTimeout(showInstallBanner, 2500);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    document.querySelector(".pwa-banner")?.remove();
    document.querySelectorAll("[data-install-app]").forEach((b) => (b.hidden = true));
  });

  async function promptInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome !== "accepted") store.set(DISMISS_KEY, String(Date.now()));
    deferredPrompt = null;
  }

  function showInstallBanner() {
    if (!deferredPrompt || isStandalone()) return;
    const el = banner(`
      <img src="${iconUrl}" alt="">
      <div class="pwa-text"><strong>Install BloodLink</strong>Get the app on your device for quick access, even offline.</div>
      <div class="pwa-actions">
        <button class="pwa-btn pwa-btn-ghost" data-act="later">Not now</button>
        <button class="pwa-btn pwa-btn-primary" data-act="install">Install</button>
      </div>`);
    el.querySelector('[data-act="install"]').onclick = () => { hide(el); promptInstall(); };
    el.querySelector('[data-act="later"]').onclick = () => { store.set(DISMISS_KEY, String(Date.now())); hide(el); };
  }

  // Any element with data-install-app becomes an install button.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-install-app]");
    if (!btn) return;
    e.preventDefault();
    if (deferredPrompt) promptInstall();
    else if (isIOS) showIOSBanner(true);
  });

  // ---------- Install: iPhone / iPad (Safari) ----------
  const SHARE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/></svg>';
  const ADD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  function showIOSBanner(force = false) {
    if (isStandalone() || (!force && recentlyDismissed())) return;
    const where = isIOSSafari ? "" : " (open this page in Safari first)";
    const el = banner(`
      <img src="${iconUrl}" alt="">
      <div class="pwa-text"><strong>Install BloodLink${where}</strong>
        <ol class="pwa-ios-steps">
          <li>1. Tap ${SHARE_ICON} <b>Share</b></li>
          <li>2. Choose ${ADD_ICON} <b>Add to Home Screen</b></li>
        </ol>
      </div>
      <div class="pwa-actions"><button class="pwa-btn pwa-btn-ghost" data-act="close" aria-label="Close">✕</button></div>`);
    el.querySelector('[data-act="close"]').onclick = () => { store.set(DISMISS_KEY, String(Date.now())); hide(el); };
  }

  if (isIOS && !isStandalone()) {
    document.querySelectorAll("[data-install-app]").forEach((b) => (b.hidden = false));
    window.addEventListener("load", () => setTimeout(() => showIOSBanner(false), 3000));
  }

  // ---------- Service worker + update notice ----------
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  window.addEventListener("load", async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI).href);
    } catch (err) {
      console.warn("[pwa] service worker registration failed", err);
      return;
    }

    const offerUpdate = (worker) => {
      const el = banner(`
        <img src="${iconUrl}" alt="">
        <div class="pwa-text"><strong>Update available</strong>A new version of BloodLink is ready.</div>
        <div class="pwa-actions"><button class="pwa-btn pwa-btn-primary" data-act="reload">Update</button></div>`);
      el.querySelector('[data-act="reload"]').onclick = () => worker.postMessage("SKIP_WAITING");
    };

    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      nw?.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(nw);
      });
    });

    // Only reload when an *update* takes over, not on the very first install.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });

    // Check for a new version when the app comes back to the foreground.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  });
})();
