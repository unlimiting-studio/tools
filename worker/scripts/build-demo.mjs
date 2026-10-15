// clients/web을 한 파일로 번들해 /demo/client.js로 서빙하도록 문자열 모듈로 만든다.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const web = new URL("../../clients/web/", import.meta.url).pathname;
execSync("npm run build", { cwd: web, stdio: "inherit" });
const { build } = createRequire(web + "package.json")("esbuild");
const out = await build({
  stdin: { contents: 'export * from "./dist/index.js"; export * from "./dist/cropper.js";', resolveDir: web, loader: "js" },
  bundle: true,
  format: "esm",
  minify: true,
  write: false,
  legalComments: "inline",
});
writeFileSync("src/demo/client.gen.ts", `// 자동 생성 파일. npm run build:demo로 다시 만든다.\nexport default ${JSON.stringify(out.outputFiles[0].text)};\n`);
