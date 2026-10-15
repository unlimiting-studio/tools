// GET /demo: 휴대폰에서 직접 써 보는 프로필 크롭 데모.
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
<title>프로필 사진 자동 크롭</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f4; --fg:#1a1a1a; --muted:#6b6b6b; --card:#fff; --line:#e4e4e0; --accent:#2f6fed; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121212; --fg:#eee; --muted:#9a9a9a; --card:#1c1c1c; --line:#2c2c2c; --accent:#6c9bff; } }
  * { box-sizing: border-box; }
  body { margin:0; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif;
         background:var(--bg); color:var(--fg); padding: max(20px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom)); }
  main { max-width: 560px; margin: 0 auto; display:flex; flex-direction:column; gap:16px; }
  h1 { font-size: 22px; margin: 4px 0 0; }
  p.lead { margin: 0; color: var(--muted); font-size: 15px; }
  label.pick { display:flex; align-items:center; justify-content:center; gap:8px; min-height:56px; border-radius:14px;
               background:var(--accent); color:#fff; font-weight:600; font-size:17px; cursor:pointer; user-select:none; }
  label.pick:active { opacity:.85; }
  input[type=file] { display:none; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; }
  .result { display:flex; gap:16px; align-items:center; }
  .avatar { width:96px; height:96px; border-radius:50%; object-fit:cover; flex:none; background:var(--line); }
  .square { width:96px; height:96px; border-radius:12px; object-fit:cover; flex:none; background:var(--line); }
  .meta { font-size:14px; color:var(--muted); display:grid; gap:2px; white-space:nowrap; }
  .meta b { color:var(--fg); font-weight:600; }
  .stage { position:relative; line-height:0; border-radius:12px; overflow:hidden; }
  .stage img { width:100%; height:auto; display:block; }
  .box { position:absolute; border:3px solid #39d353; box-shadow:0 0 0 9999px rgba(0,0,0,.45); border-radius:4px; }
  .status { font-size:15px; color:var(--muted); text-align:center; min-height:24px; }
  .error { color:#e5484d; }
  .spinner { display:inline-block; width:16px; height:16px; border:2px solid currentColor; border-right-color:transparent;
             border-radius:50%; animation:spin .8s linear infinite; vertical-align:-3px; margin-right:6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>프로필 사진 자동 크롭</h1>
  <p class="lead">사진을 고르면 얼굴(사람·동물)을 찾아 정사각형으로 자릅니다. 얼굴이 없으면 가장 중요한 피사체를 기준으로 자릅니다.</p>

  <label class="pick">사진 선택하기<input id="file" type="file" accept="image/*"></label>
  <div id="status" class="status"></div>

  <section id="out" class="card" hidden>
    <div class="result">
      <img id="avatar" class="avatar" alt="원형 프로필 미리보기">
      <img id="square" class="square" alt="정사각형 결과">
      <div class="meta">
        <div>기준 <b id="mode"></b></div>
        <div>얼굴 확률 <b id="face"></b></div>
        <div>처리 시간 <b id="ms"></b></div>
      </div>
    </div>
  </section>

  <section id="orig" class="card" hidden>
    <div class="stage"><img id="photo" alt="원본 사진"><div id="box" class="box"></div></div>
  </section>
</main>
<script type="module">
import { createToolsClient } from "/demo/client.js";
const tools = createToolsClient({ apiKey: __DEMO_API_KEY__, baseUrl: location.origin });
const $ = (id) => document.getElementById(id);
let urls = [];

$("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  urls.forEach(URL.revokeObjectURL); urls = [];
  const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  $("out").hidden = true; $("orig").hidden = true;
  $("status").className = "status";
  $("status").innerHTML = '<span class="spinner"></span>얼굴을 찾는 중…';
  try {
    const t = performance.now();
    const r = await tools.profileCrop(file, { size: 512 });
    const ms = Math.round(performance.now() - t);

    $("avatar").src = $("square").src = url(r.blob);
    $("mode").textContent = r.mode === "face" ? "얼굴" : "피사체";
    $("face").textContent = Math.round(r.faceProbability * 100) + "%";
    $("ms").textContent = (ms / 1000).toFixed(1) + "초";
    $("photo").src = url(file);
    Object.assign($("box").style, {
      left: r.crop.left * 100 + "%", top: r.crop.top * 100 + "%",
      width: r.crop.width * 100 + "%", height: r.crop.height * 100 + "%",
    });
    $("status").textContent = "";
    $("out").hidden = false; $("orig").hidden = false;
  } catch (err) {
    $("status").className = "status error";
    $("status").textContent = err.message || "처리하지 못했습니다";
  }
});
</script>
</body>
</html>`;
