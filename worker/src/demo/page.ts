// GET /demo: 휴대폰에서 직접 써 보는 프로필 크롭 화면 데모.
// 데모 키(DEMO_API_KEY)는 이 Worker의 Origin에서만 쓰도록 발급하고, 페이지를 서빙할 때 주입한다.
import clientJs from "./client.gen";

export function demoClientJs(): Response {
  return new Response(clientJs, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

export function demoPage(env: Env): Response {
  const html = HTML.replace("__DEMO_API_KEY__", JSON.stringify(env.DEMO_API_KEY ?? ""));
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

const HTML = /* html */ `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>프로필 사진 크롭</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f4; --fg:#1a1a1a; --muted:#6b6b6b; --card:#fff; --line:#e4e4e0; --accent:#2f6fed; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121212; --fg:#eee; --muted:#9a9a9a; --card:#1c1c1c; --line:#2c2c2c; --accent:#6c9bff; } }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif;
         background:var(--bg); color:var(--fg); padding: max(20px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom)); }
  main { max-width: 560px; margin: 0 auto; display:flex; flex-direction:column; gap:16px; }
  h1 { font-size: 22px; margin: 4px 0 0; }
  p.lead { margin: 0; color: var(--muted); font-size: 15px; }
  label.pick { display:flex; align-items:center; justify-content:center; min-height:56px; border-radius:14px;
               background:var(--accent); color:#fff; font-weight:600; font-size:17px; cursor:pointer; user-select:none; }
  label.pick:active { opacity:.85; }
  input[type=file] { display:none; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; display:grid; gap:12px; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:15px; }
  .seg { display:inline-flex; background:rgba(127,127,127,.16); border-radius:10px; padding:2px; }
  .seg button { border:0; background:transparent; color:inherit; font:inherit; font-size:14px; padding:6px 10px; border-radius:8px; cursor:pointer; }
  .seg button[aria-pressed=true] { background:var(--card); box-shadow:0 1px 3px rgba(0,0,0,.15); font-weight:600; }
  .result { display:flex; gap:16px; align-items:center; }
  .result img { width:112px; height:112px; flex:none; object-fit:cover; background:var(--line); }
  .meta { font-size:14px; color:var(--muted); display:grid; gap:2px; }
  .meta b { color:var(--fg); font-weight:600; }
  .error { color:#e5484d; font-size:14px; }

  #editor { position:fixed; inset:0; background:#000; color:#fff; display:flex; flex-direction:column; z-index:10; }
  #editor .bar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 12px; min-height:56px; }
  #editor .top { padding-top: max(12px, env(safe-area-inset-top)); }
  #editor .bottom { padding-bottom: max(16px, env(safe-area-inset-bottom)); justify-content:center; flex-wrap:wrap; }
  #editor .bar > button { border:0; background:transparent; color:#fff; font:inherit; font-size:17px; padding:8px 10px; cursor:pointer; }
  #editor .bar > button.done { color:#ffd84d; font-weight:600; }
  #editor .hint { font-size:14px; color:rgba(255,255,255,.75); text-align:center; flex:1; }
  #editor .stage { flex:1; min-height:0; }
  #editor .seg { background:rgba(255,255,255,.14); }
  #editor .seg button[aria-pressed=true] { background:rgba(255,255,255,.9); color:#000; }
  #editor .ghost { border:1px solid rgba(255,255,255,.35); background:transparent; color:#fff; font:inherit; font-size:14px; padding:6px 12px; border-radius:10px; cursor:pointer; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>프로필 사진 크롭</h1>
  <p class="lead">사진을 고르면 얼굴(사람·동물)을 찾아 프레임을 맞춥니다. 얼굴이 없으면 가장 중요한 피사체에 맞춥니다. 그다음 끌거나 두 손가락으로 확대해 고칠 수 있습니다.</p>

  <section class="card">
    <div class="row">프레임 모양
      <span class="seg" data-name="shape"><button data-v="circle">원형</button><button data-v="square">정사각형</button><button data-v="rounded">둥근 사각형</button></span>
    </div>
    <div class="row">그리드
      <span class="seg" data-name="grid"><button data-v="interacting">조작할 때</button><button data-v="always">항상</button><button data-v="hidden">숨김</button></span>
    </div>
  </section>

  <label class="pick">사진 선택하기<input id="file" type="file" accept="image/*"></label>

  <section id="out" class="card" hidden>
    <div class="result">
      <img id="avatar" alt="크롭 결과">
      <div class="meta">
        <div>자동 크롭 기준 <b id="mode">-</b></div>
        <div>얼굴 확률 <b id="face">-</b></div>
        <div>자동 크롭 시간 <b id="ms">-</b></div>
        <div>결과 크기 <b id="px">-</b></div>
      </div>
    </div>
  </section>
</main>

<div id="editor" hidden>
  <div class="bar top">
    <button id="cancel">취소</button>
    <div id="hint" class="hint"></div>
    <button id="done" class="done">완료</button>
  </div>
  <div id="stage" class="stage"></div>
  <div class="bar bottom">
    <span class="seg" data-name="shape"><button data-v="circle">원형</button><button data-v="square">정사각형</button><button data-v="rounded">둥근 사각형</button></span>
    <button id="reset" class="ghost">자동 크롭으로</button>
  </div>
</div>

<script type="module">
import { createToolsClient, createProfileCropper } from "/demo/client.js";
const tools = createToolsClient({ apiKey: __DEMO_API_KEY__, baseUrl: location.origin });
const $ = (id) => document.getElementById(id);
const settings = { shape: "circle", grid: "interacting" };
let cropper = null, auto = null, resultUrl = null;

function syncSegs() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === settings[seg.dataset.name]))));
  $("avatar").style.borderRadius = { circle: "50%", square: "0", rounded: "20%" }[settings.shape];
}
document.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
  const v = e.target.dataset && e.target.dataset.v;
  if (!v) return;
  settings[seg.dataset.name] = v;
  if (cropper) seg.dataset.name === "shape" ? cropper.setShape(v) : cropper.setGrid(v);
  syncSegs();
}));
syncSegs();

function close() {
  cropper?.destroy(); cropper = null;
  $("editor").hidden = true;
  document.body.style.overflow = "";
}

$("file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  $("editor").hidden = false;
  document.body.style.overflow = "hidden";
  $("hint").textContent = "얼굴을 찾는 중…";
  auto = null;
  const t = performance.now();
  cropper = createProfileCropper($("stage"), {
    image: file, client: tools, shape: settings.shape, grid: settings.grid,
    onAutoCrop(r, applied) {
      auto = { ...r, ms: performance.now() - t };
      $("hint").textContent = (r.mode === "face" ? "얼굴" : "피사체") + "에 맞췄습니다" + (applied ? "" : " (직접 옮긴 위치 유지)");
    },
    onError(err) {
      $("hint").textContent = "자동 크롭 실패: " + (err.message || err) + ". 직접 맞춰 주세요";
    },
  });
});

$("cancel").addEventListener("click", close);
$("reset").addEventListener("click", () => cropper?.reset());
$("done").addEventListener("click", async () => {
  if (!cropper) return;
  const r = await cropper.crop({ size: 512 });
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  $("avatar").src = resultUrl = URL.createObjectURL(r.blob);
  $("mode").textContent = auto ? (auto.mode === "face" ? "얼굴" : "피사체") : "실패";
  $("face").textContent = auto ? Math.round(auto.faceProbability * 100) + "%" : "-";
  $("ms").textContent = auto ? (auto.ms / 1000).toFixed(1) + "초" : "-";
  $("px").textContent = "원본 " + r.pixels.size + "px → 512px";
  $("out").hidden = false;
  close();
});
</script>
</body>
</html>`;
