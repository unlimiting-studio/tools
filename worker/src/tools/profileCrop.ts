// 프로필 사진 정사각형 크롭 영역 계산.
// 얼굴이 있으면 눈·코·입 박스 중심, 없으면 가장 중요한 피사체 박스 중심에 맞춘다.
// Jev(typesafe/jev-1.14) 호출 1회로 얼굴 여부와 두 박스를 함께 받는다.
import { imageSize, type ImageInfo } from "../image";
import { HttpError } from "../http";

const MODEL = "typesafe/jev-1.14";
const FACE_SCALE = 2.4;
const SUBJECT_SCALE = 1.15;
// 얼굴이 가장자리에 붙었을 때 얼굴 중심이 프레임 중앙에서 벗어나도 되는 거리 (한 변 대비)
const FACE_MAX_OFFSET = 0.15;
const FACE_THRESHOLD = 0.5;
const MAX_BYTES = 2 * 1024 * 1024;

const QUESTIONS = {
  has_face: { type: "noul", instructions: "The photo clearly shows the face of a person or an animal." },
  face: { type: "box", instructions: "the main subject's eyes, nose and mouth together in the photo" },
  subject: { type: "box", instructions: "the most important, in-focus subject of the photo" },
};

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 이미지 크기에 대한 비율(0~1). 픽셀 기준으로 정사각형이다. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ProfileCropResult {
  mode: "face" | "subject";
  crop: CropRect;
  faceProbability: number;
  confidence: number;
}

/** 박스 중심에 맞춘 정사각형. 얼굴은 중심을 지키고 넘치면 줄이며, 피사체는 크기를 지키고 안쪽으로 민다. */
// 박스 중심에 맞춘 정사각형을 이미지 안으로 민다. 중심은 한 변의 maxOffset 비율까지만 벗어날 수 있고,
// 그보다 더 밀어야 하면 정사각형을 줄인다. maxOffset 0이면 중심 고정, 0.5 이상이면 줄이지 않고 밀기만 한다.
export function squareCrop(W: number, H: number, box: Box, scale: number, maxOffset: number): CropRect {
  const l = box.left * W, r = box.right * W, t = box.top * H, b = box.bottom * H;
  const cx = (l + r) / 2, cy = (t + b) / 2;
  let side = Math.min(Math.max(r - l, b - t) * scale, W, H);
  if (maxOffset < 0.5) {
    // 중심에서 가까운 가장자리까지 거리 d에 대해 side·(0.5 − maxOffset) ≤ d 여야 한다
    const d = Math.min(cx, W - cx, cy, H - cy);
    side = Math.min(side, d / (0.5 - maxOffset));
  }
  side = Math.max(1, side);
  const x0 = Math.min(Math.max(cx - side / 2, 0), W - side);
  const y0 = Math.min(Math.max(cy - side / 2, 0), H - side);
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return { left: round(x0 / W), top: round(y0 / H), width: round(side / W), height: round(side / H) };
}

interface JevAnswers {
  has_face: { noul: number };
  face: { box: Box; confidence: number };
  subject: { box: Box; confidence: number };
}

export async function profileCrop(request: Request, env: Env): Promise<ProfileCropResult> {
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  if (type !== "image/jpeg" && type !== "image/png") {
    throw new HttpError(415, "본문은 image/jpeg 또는 image/png 바이트여야 합니다");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "이미지는 2MB 이하여야 합니다");

  const info = imageSize(bytes);
  if (!info) throw new HttpError(400, "JPEG/PNG 헤더를 읽을 수 없습니다");
  validateSize(info);

  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      state: ["Photo:", { type: "image_url", image_url: { url: `data:${type};base64,${toBase64(bytes)}` } }],
      questions: QUESTIONS,
    }),
  });
  if (!res.ok) {
    console.error("jev error", res.status, await res.text());
    throw new HttpError(502, "크롭 영역을 계산하지 못했습니다");
  }
  const a = ((await res.json()) as { answers: JevAnswers }).answers;

  const faceProbability = a.has_face.noul;
  if (faceProbability >= FACE_THRESHOLD) {
    return { mode: "face", crop: squareCrop(info.width, info.height, a.face.box, FACE_SCALE, FACE_MAX_OFFSET), faceProbability, confidence: a.face.confidence };
  }
  return { mode: "subject", crop: squareCrop(info.width, info.height, a.subject.box, SUBJECT_SCALE, 0.5), faceProbability, confidence: a.subject.confidence };
}

// Jev 이미지 제한: 각 변 256~1568px. 비용을 위해 클라이언트는 긴 변 512px로 보낸다.
function validateSize({ width, height }: ImageInfo) {
  if (Math.min(width, height) < 256 || Math.max(width, height) > 1568) {
    throw new HttpError(400, `이미지 각 변은 256~1568px여야 합니다 (받은 크기 ${width}x${height}). 긴 변 512px로 줄여 보내세요`);
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
