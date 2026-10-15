import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { createApi } from "@tracetray/shared";
import { ApiProvider } from "./api";
import { writeStorage } from "./lib/storage";
import App from "./App";
import "./styles.css";

function SignedInOnly({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    // The public pages only load Clerk (and its cookies) for browsers marked here.
    writeStorage("tt-signed-in", isSignedIn ? "1" : null);
    if (!isSignedIn) window.location.replace("/sign-in");
  }, [isLoaded, isSignedIn]);
  return isLoaded && isSignedIn ? <>{children}</> : null;
}

declare global {
  interface Window { TraceTray?: { endpoint: string; key: string } }
}

// TraceTray tracks its own dashboard when TRACETRAY_OWN_SITE_KEY is set, as a live field test.
function trackOwnDashboard(siteKey: string | null) {
  if (!siteKey) return;
  window.TraceTray = { endpoint: `${window.location.origin}/collect`, key: siteKey };
  const script = document.createElement("script");
  script.src = "/client/tracker.js";
  script.async = true;
  document.head.appendChild(script);
}

const root = createRoot(document.getElementById("root")!);

createApi({ getToken: async () => null }).config()
  .then(config => {
    trackOwnDashboard(config.site_key);
    root.render(
      <StrictMode>
        <ClerkProvider publishableKey={config.clerk_publishable_key} afterSignOutUrl="/">
          <SignedInOnly>
            <ApiProvider>
              <BrowserRouter basename="/app">
                <App mode={config.mode} />
              </BrowserRouter>
            </ApiProvider>
          </SignedInOnly>
        </ClerkProvider>
      </StrictMode>
    );
  })
  .catch(() => {
    root.render(<p style={{ padding: 24, fontFamily: "system-ui" }}>TraceTray couldn't load. Refresh the page to try again.</p>);
  });
