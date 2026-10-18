import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

const root = new URL("../", import.meta.url);
const logo = await readFile(new URL("../server/public/logo-mark.svg", root), "utf8");
const paths = logo.match(/<path\b[^>]*\/>/g).join("");
const gradient = logo.match(/<defs>[\s\S]*?<\/defs>/)[0];
const fullIcon = logo.replace('rx="15"', 'rx="0"');
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 80 80">${paths}</svg>`;
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
await render(fullIcon, "store/icon.png", 512, true);
await render(await readFile(new URL("store/feature-graphic.svg", root), "utf8"), "store/feature-graphic.png", 1024, true);
