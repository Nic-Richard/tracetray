import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import "../../web/src/styles.css";
import "./surface.css";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (value: string) => void };
    tracetrayRender: (props: unknown) => void;
  }
}

export function mount<P extends { dark: boolean }>(render: (props: P) => ReactNode) {
  const element = document.getElementById("root")!;
  const root = createRoot(element);
  const send = (value: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(value));
  window.tracetrayRender = props => {
    const data = props as P;
    document.documentElement.dataset.theme = data.dark ? "dark" : "light";
    root.render(render(data));
  };
  new ResizeObserver(() => send({ type: "height", value: element.scrollHeight })).observe(element);
  window.addEventListener("error", () => send({ type: "error" }));
  send({ type: "ready" });
}
