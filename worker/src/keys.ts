// 프로젝트별 API 키. KV에는 키 원문이 아니라 SHA-256 해시만 저장한다.
//   key:<hash> → KeyRecord
//   id:<id>    → <hash>   (목록·폐기용)
import { HttpError } from "./http";

export interface KeyRecord {
  id: string;
  name: string;
  /** 브라우저 호출을 허용할 Origin (예: https://example.com). */
  origins: string[];
  /** 앱 호출을 허용할 앱 ID (iOS 번들 ID, Android 패키지명). X-App-Id 헤더로 받는다. */
  appIds: string[];
  createdAt: string;
}

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const randomToken = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** 호출자를 인증하고 키 레코드를 돌려준다. 실패하면 HttpError를 던진다. */
export async function authenticate(request: Request, env: Env): Promise<KeyRecord> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Authorization: Bearer <API 키>가 필요합니다");
  const record = await env.KEYS.get<KeyRecord>(`key:${await sha256(token)}`, "json");
  if (!record) throw new HttpError(401, "유효하지 않은 API 키입니다");

  // 허용 목록이 비어 있으면 서버용 키로 보고 제한하지 않는다.
  if (record.origins.length || record.appIds.length) {
    const origin = request.headers.get("origin");
    const appId = request.headers.get("x-app-id");
    const ok = (origin && record.origins.includes(origin)) || (appId && record.appIds.includes(appId));
    if (!ok) throw new HttpError(403, "이 키에 허용되지 않은 Origin 또는 앱입니다");
  }

  const { success } = await env.RATE_LIMITER.limit({ key: record.id });
  if (!success) throw new HttpError(429, "호출 한도를 넘었습니다. 잠시 후 다시 시도하세요");
  return record;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

export async function createKey(env: Env, input: unknown) {
  const { name, origins = [], appIds = [] } = (input ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name) throw new HttpError(400, "name이 필요합니다");
  if (!isStringArray(origins) || !isStringArray(appIds)) throw new HttpError(400, "origins와 appIds는 문자열 배열이어야 합니다");
  const record: KeyRecord = {
    id: `k_${randomToken(6)}`,
    name,
    origins,
    appIds,
    createdAt: new Date().toISOString(),
  };
  const key = `tk_${randomToken(24)}`;
  const hash = await sha256(key);
  await env.KEYS.put(`key:${hash}`, JSON.stringify(record));
  await env.KEYS.put(`id:${record.id}`, hash);
  return { key, ...record }; // 키 원문은 이 응답에서 한 번만 보여준다
}

export async function listKeys(env: Env): Promise<KeyRecord[]> {
  const { keys } = await env.KEYS.list({ prefix: "key:" });
  const records = await Promise.all(keys.map((k) => env.KEYS.get<KeyRecord>(k.name, "json")));
  return records.filter((r): r is KeyRecord => r !== null);
}

export async function deleteKey(env: Env, id: string) {
  const hash = await env.KEYS.get(`id:${id}`);
  if (!hash) throw new HttpError(404, "없는 키입니다");
  await env.KEYS.delete(`key:${hash}`);
  await env.KEYS.delete(`id:${id}`);
}

/** ADMIN_TOKEN과 상수 시간으로 비교한다. */
export async function requireAdmin(request: Request, env: Env) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  const [a, b] = await Promise.all([sha256(token), sha256(env.ADMIN_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0) throw new HttpError(401, "관리자 토큰이 필요합니다");
}
