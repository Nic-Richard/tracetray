export function installationSnippet(dashboard: string, key: string): string {
  const origin = new URL(dashboard).origin;
  const quotedKey = JSON.stringify(key).replace(/</g, "\\u003c");
  return `<script>\n  window.TraceTray = { endpoint: "${origin}/collect", key: ${quotedKey} };\n</script>\n<script src="${origin}/client/tracker.js"></script>`;
}
