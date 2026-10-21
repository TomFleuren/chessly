import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });

await esbuild.build({
  entryPoints: {
    background: "src/background.js",
    content: "src/content/content.js",
  },
  bundle: true,
  format: "iife",
  outdir: "dist",
  target: ["chrome114"],
  legalComments: "none",
  logLevel: "info",
});

await copyFile("src/offscreen.js", "dist/offscreen.js");
await copyFile("src/offscreen.html", "dist/offscreen.html");
