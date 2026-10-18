import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fonts = "";
for (const [weight, name] of [[400, "Regular"], [600, "SemiBold"], [700, "Bold"]]) {
  const bytes = await readFile(resolve(mobile, `../node_modules/@expo-google-fonts/instrument-sans/${weight}${name}/InstrumentSans_${weight}${name}.ttf`));
  fonts += `@font-face{font-family:'Instrument Sans';font-weight:${weight};src:url(data:font/ttf;base64,${bytes.toString("base64")})}`;
}
for (const name of ["trends", "attention", "advanced"]) {
  const result = await build({
    entryPoints: [resolve(mobile, `surfaces/${name}.tsx`)],
    bundle: true, write: false, outdir: "out", minify: true,
    format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }
  });
  const css = result.outputFiles.find(file => file.path.endsWith(".css")).text;
  const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'"><style>${fonts + css}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(resolve(mobile, "generated"), { recursive: true });
  await writeFile(resolve(mobile, `generated/${name}.json`), JSON.stringify({ html }));
  console.log(`Bundled shared ${name} surface (${Math.round(html.length / 1024)} KB).`);
}
