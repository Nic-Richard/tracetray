export function resolveApiUrl(explicit: string | undefined, hostUri: string | undefined, development: boolean): string {
  const host = hostUri?.match(/^(\[[^\]]+\]|[^:/]+)(?::\d+)?(?:\/|$)/)?.[1] || "10.0.2.2";
  const value = explicit?.trim() || (development ? `http://${host}:5000` : "https://tracetray.com");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("The API address must be an HTTP or HTTPS origin.");
  }
  if (!development && url.protocol !== "https:") throw new Error("Release builds need an HTTPS API address.");
  return url.origin;
}
