// unlimiting-studio tools 웹 클라이언트.
// 이미지를 줄여서 API에 보내고, 받은 크롭 영역으로 원본을 브라우저에서 자른다.

export const DEFAULT_BASE_URL = "https://tools.yechanny.workers.dev";

/** 이미지 크기에 대한 비율(0~1). 픽셀 기준으로 정사각형이다. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ProfileCropRect {
  /** face: 사람·동물 얼굴 기준, subject: 얼굴이 없어 주요 피사체 기준 */
  mode: "face" | "subject";
  crop: CropRect;
  faceProbability: number;
  confidence: number;
}

export interface ProfileCropResult extends ProfileCropRect {
  /** 잘라낸 정사각형 이미지 */
  blob: Blob;
  /** 원본 픽셀 기준 크롭 영역 */
  pixels: { x: number; y: number; size: number };
}

export interface ToolsClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ProfileCropOptions {
  /** 출력 한 변 픽셀. 생략하면 원본 해상도로 자른다. */
  size?: number;
  type?: "image/jpeg" | "image/png" | "image/webp";
  quality?: number;
  signal?: AbortSignal;
}

export class ToolsError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ToolsError";
  }
}

// 서버(Jev)는 각 변 256~1568px를 받는다. 비용은 픽셀 수에 비례하므로 긴 변 512px로 보낸다.
const SEND_LONG_SIDE = 512;
const MIN_SIDE = 256;

type Source = Blob | ImageBitmap;

export function createToolsClient({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch: f = globalThis.fetch.bind(globalThis) }: ToolsClientOptions) {
  async function profileCropRect(source: Source, { signal }: { signal?: AbortSignal } = {}): Promise<ProfileCropRect> {
    const bitmap = await toBitmap(source);
    try {
      const body = await encodeForApi(bitmap);
      const res = await f(`${baseUrl}/v1/profile-crop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "image/jpeg" },
        body,
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ToolsError(res.status, data.error ?? `HTTP ${res.status}`);
      return data as ProfileCropRect;
    } finally {
      if (!(source instanceof ImageBitmap)) bitmap.close();
    }
  }

  async function profileCrop(source: Source, opts: ProfileCropOptions = {}): Promise<ProfileCropResult> {
    const bitmap = await toBitmap(source);
    try {
      const rect = await profileCropRect(bitmap, opts);
      const { width: W, height: H } = bitmap;
      const x = Math.round(rect.crop.left * W);
      const y = Math.round(rect.crop.top * H);
      const side = Math.max(1, Math.min(Math.round(rect.crop.width * W), W - x, H - y));
      const out = opts.size ?? side;
      const canvas = makeCanvas(out, out);
      canvas.getContext("2d")!.drawImage(bitmap, x, y, side, side, 0, 0, out, out);
      const blob = await canvasToBlob(canvas, opts.type ?? "image/jpeg", opts.quality ?? 0.9);
      return { ...rect, blob, pixels: { x, y, size: side } };
    } finally {
      if (!(source instanceof ImageBitmap)) bitmap.close();
    }
  }

  return { profileCrop, profileCropRect };
}

// EXIF 회전을 적용해 디코딩한다 (서버는 회전 정보를 보지 않는다).
// "from-image"를 모르는 구형 Safari·Chrome은 옵션 없이 디코딩하며, 이때도 기본 동작이 EXIF 회전 적용이다.
async function toBitmap(source: Source): Promise<ImageBitmap> {
  if (source instanceof ImageBitmap) return source;
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    return createImageBitmap(source);
  }
}

async function encodeForApi(bitmap: ImageBitmap): Promise<Blob> {
  const { width, height } = bitmap;
  let s = SEND_LONG_SIDE / Math.max(width, height);
  if (Math.min(width, height) * s < MIN_SIDE) s = MIN_SIDE / Math.min(width, height);
  const w = Math.round(width * s), h = Math.round(height * s);
  if (Math.max(w, h) > 1568) throw new ToolsError(400, "가로세로 비율이 너무 극단적인 이미지입니다");
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvasToBlob(canvas, "image/jpeg", 0.85);
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function canvasToBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 인코딩 실패"))), type, quality),
  );
}

export type ToolsClient = ReturnType<typeof createToolsClient>;
