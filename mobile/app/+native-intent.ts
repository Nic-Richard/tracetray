export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path);
    if (url.protocol === "clerk:" && url.hostname === "com.tracetray.app.hosted-callback" && !url.username && !url.password && ["", "/"].includes(url.pathname)) {
      // WebBrowser consumes the original URL; navigation would unmount the pending sign-in.
      return initial ? "/sign-in" : "";
    }
  } catch {}
  return path;
}
