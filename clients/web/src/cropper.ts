// 프로필 사진 크롭 화면. 자동 크롭 결과를 기본값으로 띄우고, 사용자가 사진을 끌거나 핀치해서 고친다.
// 화면 조작은 Cropper.js(v1)에 맡기고, 여기서는 고정 프레임·프레임 모양·그리드·자동 크롭 연결만 다룬다.
import Cropper from "cropperjs";
import { CROPPER_CSS } from "./cropper.css.js";
import type { CropRect, ProfileCropRect, ToolsClient } from "./index.js";

export type FrameShape = "circle" | "square" | "rounded";
export type GridMode = "always" | "interacting" | "hidden";

export interface ProfileCropperOptions {
  /** 자를 사진. File·Blob이면 EXIF 회전을 적용해 표시한다. */
  image: Blob | string;
  /** 자동 크롭에 쓸 클라이언트. initialRect가 없으면 이 클라이언트로 API를 호출한다. */
  client?: ToolsClient;
  /** 이미 계산한 크롭 영역. 지정하면 API를 호출하지 않는다. */
  initialRect?: ProfileCropRect | CropRect;
  /** 프레임 모양. 기본값 circle */
  shape?: FrameShape;
  /** rounded일 때 모서리 반경. 프레임 한 변에 대한 비율, 기본값 0.2 */
  cornerRadius?: number;
  /** 3×3 그리드 표시. 기본값 interacting(조작하는 동안만) */
  grid?: GridMode;
  /** 프레임과 컨테이너 가장자리 사이 여백(px). 기본값 24 */
  framePadding?: number;
  /** 크롭 영역 바깥을 덮는 색. 기본값 rgba(0,0,0,0.55) */
  dimColor?: string;
  /** 자동 크롭 결과를 받았을 때. 사용자가 이미 사진을 움직였으면 화면에 적용하지 않는다. */
  onAutoCrop?: (rect: ProfileCropRect, applied: boolean) => void;
  /** 자동 크롭 API 호출이 실패했을 때. 화면은 가운데 크롭 상태로 계속 쓸 수 있다. */
  onError?: (error: unknown) => void;
}

export interface CropOutput {
  /** 정사각형으로 자른 이미지. 프레임이 원형이어도 이미지는 정사각형이다. */
  blob: Blob;
  /** 원본 픽셀 기준 크롭 영역 */
  pixels: { x: number; y: number; size: number };
  /** 원본 크기에 대한 비율 */
  crop: CropRect;
}

export interface ProfileCropper {
  /** 사진을 띄우고 자동 크롭 결과까지 적용하면 끝난다. API가 실패해도 reject하지 않는다. */
  ready: Promise<void>;
  /** 자동 크롭 결과(없으면 가운데 크롭)로 되돌린다. */
  reset(): void;
  /** 지금 프레임 안의 영역을 자른다. size를 생략하면 원본 해상도로 자른다. */
  crop(opts?: { size?: number; type?: "image/jpeg" | "image/png" | "image/webp"; quality?: number }): Promise<CropOutput>;
  /** 지금 프레임 안의 영역(원본 크기에 대한 비율) */
  getCrop(): CropRect;
  setShape(shape: FrameShape, cornerRadius?: number): void;
  setGrid(grid: GridMode): void;
  destroy(): void;
}

const ANIMATION_MS = 280;

export function createProfileCropper(container: HTMLElement, options: ProfileCropperOptions): ProfileCropper {
  injectStyle();
  const padding = options.framePadding ?? 24;
  const root = document.createElement("div");
  root.className = "ut-cropper";
  const img = document.createElement("img");
  img.alt = "";
  const spinner = document.createElement("div");
  spinner.className = "ut-cropper-spinner";
  // 프레임 바깥을 덮는 막. 프레임 모양대로 구멍을 뚫은 SVG 경로로 그린다.
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.classList.add("ut-cropper-overlay");
  const dim = document.createElementNS(overlay.namespaceURI, "path");
  dim.setAttribute("fill-rule", "evenodd");
  dim.setAttribute("fill", options.dimColor ?? "rgba(0,0,0,0.55)");
  const ring = document.createElementNS(overlay.namespaceURI, "path");
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "rgba(255,255,255,0.9)");
  overlay.append(dim, ring);
  root.append(img, overlay, spinner);
  container.append(root);

  const objectUrl = typeof options.image === "string" ? null : URL.createObjectURL(options.image);
  img.src = objectUrl ?? (options.image as string);

  let autoRect: CropRect | null = null;
  let touched = false;
  let animation = 0;
  let destroyed = false;
  let gridTimer: ReturnType<typeof setTimeout> | undefined;

  let frameBox: { left: number; top: number; width: number } | null = null;
  let shape: FrameShape = "circle";
  let radius = options.cornerRadius ?? 0.2;
  const setShape = (next: FrameShape, cornerRadius = radius) => {
    shape = next;
    radius = cornerRadius;
    root.style.setProperty("--ut-radius", shape === "circle" ? "50%" : shape === "rounded" ? `${radius * 100}%` : "0");
    drawOverlay();
  };
  const setGrid = (grid: GridMode) => {
    root.dataset.grid = grid;
  };
  setShape(options.shape ?? "circle");
  setGrid(options.grid ?? "interacting");

  // 조작하는 동안 그리드를 보여 준다. 휠 줌은 시작·끝 이벤트가 없어서 잠깐 보였다가 숨긴다.
  const interacting = (on: boolean, linger = 0) => {
    clearTimeout(gridTimer);
    if (on) root.classList.add("ut-interacting");
    if (!on || linger) gridTimer = setTimeout(() => root.classList.remove("ut-interacting"), linger || 150);
  };

  let cropper: Cropper;
  const ready = new Promise<void>((resolve) => {
    cropper = new Cropper(img, {
      viewMode: 1, // 사진이 항상 프레임을 덮도록 제한한다
      dragMode: "move",
      aspectRatio: 1,
      autoCropArea: 1,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      checkOrientation: false, // 브라우저가 <img>에 EXIF 회전을 적용한다
      responsive: false, // 컨테이너 크기 변화는 ResizeObserver로 직접 처리한다
      restore: false,
      background: false,
      center: false,
      highlight: false,
      guides: false, // 그리드는 원형 프레임에 맞게 잘리도록 직접 그린다
      zoomOnTouch: true,
      zoomOnWheel: true,
      wheelZoomRatio: 0.08,
      ready() {
        layout(centerRect());
        resolve();
      },
      cropstart() {
        touched = true;
        cancelAnimationFrame(animation);
        interacting(true);
      },
      cropend() {
        interacting(false);
      },
      zoom(e) {
        if (!e.detail.originalEvent) return;
        touched = true;
        cancelAnimationFrame(animation);
        // 핀치는 cropstart·cropend 사이에서 일어나므로 휠 줌만 따로 처리한다
        if (e.detail.originalEvent.type === "wheel") interacting(true, 500);
      },
    });
  }).then(() => loadAutoRect());

  async function loadAutoRect() {
    if (options.initialRect) {
      autoRect = "crop" in options.initialRect ? options.initialRect.crop : options.initialRect;
      if (!destroyed) layout(autoRect);
      return;
    }
    if (!options.client) return;
    root.classList.add("ut-loading");
    try {
      const source = typeof options.image === "string" ? await (await fetch(options.image)).blob() : options.image;
      const result = await options.client.profileCropRect(source);
      if (destroyed) return;
      autoRect = result.crop;
      const apply = !touched;
      if (apply) animateTo(autoRect);
      options.onAutoCrop?.(result, apply);
    } catch (e) {
      if (!destroyed) options.onError?.(e);
    } finally {
      root.classList.remove("ut-loading");
    }
  }

  function centerRect(): CropRect {
    const { naturalWidth: W, naturalHeight: H } = cropper.getImageData();
    const side = Math.min(W, H);
    return { left: (W - side) / 2 / W, top: (H - side) / 2 / H, width: side / W, height: side / H };
  }

  // 프레임을 컨테이너 가운데 고정 크기로 놓고, 크롭 영역이 프레임에 맞도록 사진 위치와 배율을 계산한다.
  function frameAndCanvas(rect: CropRect) {
    const c = cropper.getContainerData();
    const side = Math.max(1, Math.min(c.width, c.height) - padding * 2);
    const frame = { left: (c.width - side) / 2, top: (c.height - side) / 2, width: side, height: side };
    const { naturalWidth: W, naturalHeight: H } = cropper.getImageData();
    const scale = side / (rect.width * W);
    return { frame, canvas: { left: frame.left - rect.left * W * scale, top: frame.top - rect.top * H * scale, width: W * scale } };
  }

  function drawOverlay() {
    if (!frameBox) return;
    const { width: w, height: h } = cropper.getContainerData();
    const { left: x, top: y, width: s } = frameBox;
    const r = shape === "circle" ? s / 2 : shape === "rounded" ? s * radius : 0;
    const hole = `M${x + r},${y}H${x + s - r}A${r},${r} 0 0 1 ${x + s},${y + r}V${y + s - r}A${r},${r} 0 0 1 ${x + s - r},${y + s}` +
      `H${x + r}A${r},${r} 0 0 1 ${x},${y + s - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
    overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
    dim.setAttribute("d", `M0,0H${w}V${h}H0Z${hole}`);
    ring.setAttribute("d", hole);
  }

  function layout(rect: CropRect) {
    cancelAnimationFrame(animation);
    const { frame, canvas } = frameAndCanvas(rect);
    // 사진을 먼저 키워 둬야 viewMode 1 제한에 걸려 프레임이 줄어들지 않는다
    cropper.setCanvasData(canvas);
    cropper.setCropBoxData(frame);
    cropper.setCanvasData(canvas);
    frameBox = frame;
    drawOverlay();
  }

  function animateTo(rect: CropRect) {
    cancelAnimationFrame(animation);
    const from = cropper.getCanvasData();
    const { canvas: to } = frameAndCanvas(rect);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const k = 1 - (1 - t) ** 3;
      cropper.setCanvasData({
        left: from.left + (to.left - from.left) * k,
        top: from.top + (to.top - from.top) * k,
        width: from.width + (to.width - from.width) * k,
      });
      if (t < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  }

  function getCrop(): CropRect {
    const d = cropper.getData(true);
    const { naturalWidth: W, naturalHeight: H } = cropper.getImageData();
    return { left: d.x / W, top: d.y / H, width: d.width / W, height: d.height / H };
  }

  let lastSize = "";
  const observer = new ResizeObserver(() => {
    const size = `${container.clientWidth}x${container.clientHeight}`;
    if (size === lastSize) return;
    const first = !lastSize;
    lastSize = size;
    if (first) return;
    const current = getCrop();
    // Cropper.js에는 컨테이너 크기를 다시 재는 공개 API가 없어 내부 resize()를 호출한다 (restore: false라 다시 그리기만 한다)
    (cropper as unknown as { resize(): void }).resize();
    layout(current);
  });
  ready.then(() => !destroyed && observer.observe(container));

  return {
    ready,
    reset() {
      touched = false;
      animateTo(autoRect ?? centerRect());
    },
    getCrop,
    async crop({ size, type = "image/jpeg", quality = 0.9 } = {}) {
      await ready;
      const d = cropper.getData(true);
      const side = Math.min(d.width, d.height);
      const out = size ?? side;
      const canvas = cropper.getCroppedCanvas({ width: out, height: out, imageSmoothingQuality: "high", fillColor: "#fff" });
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 인코딩 실패"))), type, quality),
      );
      return { blob, pixels: { x: d.x, y: d.y, size: side }, crop: getCrop() };
    },
    setShape,
    setGrid,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animation);
      clearTimeout(gridTimer);
      observer.disconnect();
      cropper.destroy();
      root.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  };
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const style = document.createElement("style");
  style.dataset.unlimitingTools = "cropper";
  style.textContent = CROPPER_CSS + STYLE;
  document.head.append(style);
}

// 프레임 모양은 바깥 막(SVG)과 그리드를 자르는 view-box의 border-radius로 표현한다.
const STYLE = `
.ut-cropper{position:relative;width:100%;height:100%;overflow:hidden;background:#000;touch-action:none;user-select:none;-webkit-user-select:none}
.ut-cropper>img{display:block;max-width:100%}
.ut-cropper .cropper-modal{opacity:0}
.ut-cropper .cropper-view-box{outline:0;border-radius:var(--ut-radius)}
.ut-cropper-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}
.ut-cropper .cropper-face{background:transparent;opacity:1}
.ut-cropper .cropper-view-box{position:relative}
.ut-cropper .cropper-view-box::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .15s;
  --l:rgba(255,255,255,.6);
  background:
    linear-gradient(to right,transparent calc(33.333% - .5px),var(--l) 0 calc(33.333% + .5px),transparent 0 calc(66.667% - .5px),var(--l) 0 calc(66.667% + .5px),transparent 0),
    linear-gradient(to bottom,transparent calc(33.333% - .5px),var(--l) 0 calc(33.333% + .5px),transparent 0 calc(66.667% - .5px),var(--l) 0 calc(66.667% + .5px),transparent 0)}
.ut-cropper[data-grid=always] .cropper-view-box::after,.ut-cropper[data-grid=interacting].ut-interacting .cropper-view-box::after{opacity:1}
.ut-cropper .cropper-line,.ut-cropper .cropper-point,.ut-cropper .cropper-center,.ut-cropper .cropper-dashed{display:none}
.ut-cropper-spinner{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px;border:3px solid rgba(255,255,255,.9);border-right-color:transparent;border-radius:50%;animation:ut-spin .8s linear infinite;pointer-events:none;display:none;z-index:10}
.ut-cropper.ut-loading .ut-cropper-spinner{display:block}
@keyframes ut-spin{to{transform:rotate(360deg)}}
`;
