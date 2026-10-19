import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

const root = new URL("../", import.meta.url);
const logo = await readFile(new URL("../server/public/logo-mark.svg", root), "utf8");
const paths = logo.match(/<path\b[^>]*\/>/g).join("");
const gradient = logo.match(/<defs>[\s\S]*?<\/defs>/)[0];
const fullIcon = logo.replace('rx="15"', 'rx="0"');
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -16 96 96">${paths}</svg>`;
const background = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${gradient}<rect width="64" height="64" fill="url(#h)"/></svg>`;
const fontFiles = ["400Regular", "600SemiBold", "700Bold"].map(weight => fileURLToPath(new URL(`../node_modules/@expo-google-fonts/instrument-sans/${weight}/InstrumentSans_${weight}.ttf`, root)));
await mkdir(new URL("assets/", root), { recursive: true });
await mkdir(new URL("store/", root), { recursive: true });

async function render(svg, path, width, opaque = false) {
  let png = new Resvg(svg, { fitTo: { mode: "width", value: width }, ...(opaque ? { background: "#ffffff" } : {}), font: { fontFiles, loadSystemFonts: false } }).render().asPng();
  if (opaque) png = PNG.sync.write(PNG.sync.read(png), { colorType: 2 });
  await writeFile(new URL(path, root), png);
  console.log(path);
}

await render(fullIcon, "assets/icon.png", 1024, true);
await render(foreground, "assets/adaptive-foreground.png", 1024);
await render(background, "assets/adaptive-background.png", 1024, true);
await render(logo, "assets/splash.png", 512);
const webIcons = await readFile(new URL("../web/src/components/Icon.tsx", root), "utf8");
const iconPaths = Object.fromEntries([...webIcons.matchAll(/^\s+(\w+): "([^"]+)"/gm)].map(match => [match[1], match[2]]));
Object.assign(iconPaths, {
  account: "M20 21v-2a6 6 0 00-6-6h-4a6 6 0 00-6 6v2M16 7a4 4 0 11-8 0 4 4 0 018 0",
  goals: "M21 12a9 9 0 11-9-9M17 12a5 5 0 11-5-5M12 12l9-9M17 3h4v4",
  trends: "M3 17l6-6 4 4 8-10M15 5h6v6",
  attention: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 11-6 0 3 3 0 016 0",
  arrow: "M9 5l7 7-7 7",
  check: "M5 12l4 4L19 6"
});
const icons = Object.fromEntries(Object.entries(iconPaths).map(([name, path]) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  return [name, `data:image/png;base64,${Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 72 } }).render().asPng()).toString("base64")}`];
}));
await writeFile(new URL("assets/icons.json", root), JSON.stringify(icons) + "\n");
await render(fullIcon, "store/icon.png", 512, true);
await render(await readFile(new URL("store/feature-graphic.svg", root), "utf8"), "store/feature-graphic.png", 1024, true);
