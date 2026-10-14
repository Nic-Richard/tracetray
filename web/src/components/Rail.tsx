import { NavLink, useLocation } from "react-router";
import { UserButton } from "@clerk/clerk-react";
import Icon from "./Icon";
import { readStorage, writeStorage } from "../lib/storage";
import { useState } from "react";

const SECTIONS = [
  { to: "/pages", icon: "pages", label: "Pages" },
  { to: "/ask", icon: "ask", label: "Ask" },
  { to: "/journeys", icon: "journeys", label: "Journeys" },
  { to: "/sessions", icon: "sessions", label: "Recent visits", desktopOnly: true },
  { to: "/setup", icon: "setup", label: "Setup" }
];

function currentTheme(): "light" | "dark" {
  const saved = readStorage("tt-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Rail({ onReportBug }: { onReportBug: () => void }) {
  const { search } = useLocation();
  const [theme, setTheme] = useState(currentTheme);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    writeStorage("tt-theme", next);
    setTheme(next);
  }

  return (
    <nav className="rail" aria-label="Sections">
      <a className="rail-mark" href="/" title="TraceTray home" aria-label="TraceTray home" />
      {SECTIONS.map(section => (
        <NavLink key={section.to} to={{ pathname: section.to, search }} title={section.label} aria-label={section.label}
          className={({ isActive }) => `rail-link${isActive ? " active" : ""}${section.desktopOnly ? " rail-desktop" : ""}`}>
          <Icon name={section.icon} />
        </NavLink>
      ))}
      <div className="rail-spacer" />
      <button type="button" className="rail-link rail-desktop" onClick={onReportBug} title="Report a bug" aria-label="Report a bug">
        <Icon name="bug" />
      </button>
      <button type="button" className="rail-link rail-desktop" onClick={toggleTheme} title={theme === "dark" ? "Light theme" : "Dark theme"} aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}>
        <Icon name={theme === "dark" ? "sun" : "moon"} />
      </button>
      <div className="rail-user">
        <UserButton>
          <UserButton.MenuItems>
            <UserButton.Link label="Billing" labelIcon={<Icon name="setup" size={14} />} href="/billing.html" />
          </UserButton.MenuItems>
        </UserButton>
      </div>
    </nav>
  );
}
