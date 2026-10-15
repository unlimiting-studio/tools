// Cropper.js의 CSS를 모듈 문자열로 만든다. 사용하는 쪽에서 CSS를 따로 불러오지 않아도 되게 한다.
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("../node_modules/cropperjs/dist/cropper.min.css", import.meta.url), "utf8");
writeFileSync(
  new URL("../src/cropper.css.ts", import.meta.url),
  `// 자동 생성 파일. cropperjs/dist/cropper.min.css (MIT, Chen Fengyuan)\nexport const CROPPER_CSS = ${JSON.stringify(css)};\n`,
);
