// Theme toggle shared with the homepage and dashboard ("tt-theme" in localStorage), plus the site's own
// tracker on pages whose script tag has data-track.
const trackPage = document.currentScript?.hasAttribute("data-track");
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById("theme");
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const label = () => toggle && toggle.setAttribute("aria-label", isDark() ? "Switch to light mode" : "Switch to dark mode");
  label();
  toggle?.addEventListener("click", () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("tt-theme", root.dataset.theme); } catch {}
    label();
  });
})();

(async () => {
  if (!trackPage) return;
  try {
    const config = await fetch("/api/config").then(r => r.json());
    if (!config.site_key) return;
    window.TraceTray = { endpoint: `${window.location.origin}/collect`, key: config.site_key };
    const script = document.createElement("script");
    script.src = "/client/tracker.js?v=20260804-3";
    script.async = true;
    document.head.appendChild(script);
  } catch (e) {
  }
})();
