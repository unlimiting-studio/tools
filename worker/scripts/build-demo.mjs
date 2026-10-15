// clients/web 빌드 결과를 /demo/client.js로 서빙하도록 문자열 모듈로 만든다.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

execSync("npm run build", { cwd: "../clients/web", stdio: "inherit" });
const js = readFileSync("../clients/web/dist/index.js", "utf8");
writeFileSync("src/demo/client.gen.ts", `// 자동 생성 파일. npm run build:demo로 다시 만든다.\nexport default ${JSON.stringify(js)};\n`);
