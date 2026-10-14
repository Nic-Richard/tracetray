import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { createApi } from "@tracetray/shared";
import { ApiProvider } from "./api";
import App from "./App";
import "./styles.css";

function SignedInOnly({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && !isSignedIn) window.location.replace("/sign-in.html");
  }, [isLoaded, isSignedIn]);
  return isLoaded && isSignedIn ? <>{children}</> : null;
}

const root = createRoot(document.getElementById("root")!);

createApi({ getToken: async () => null }).config()
  .then(config => {
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
