import esbuild from "esbuild";

const prod = process.argv.includes("production");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2018",
  external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view"],
  alias: { src: "./src" },
  define: { "process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development") },
  outfile: "main.js",
  minify: prod,
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  loader: { ".ts": "ts", ".tsx": "tsx" },
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
