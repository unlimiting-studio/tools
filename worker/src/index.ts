import { CORS_HEADERS, HttpError, json } from "./http";
import { authenticate, createKey, deleteKey, listKeys, requireAdmin } from "./keys";
import { profileCrop } from "./tools/profileCrop";

// 새 도구는 여기에 한 줄 추가한다. 모두 POST /v1/<name>, 같은 API 키로 호출한다.
const TOOLS: Record<string, (request: Request, env: Env) => Promise<unknown>> = {
  "profile-crop": profileCrop,
};

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (method === "GET" && pathname === "/") return json({ tools: Object.keys(TOOLS).map((t) => `POST /v1/${t}`) });

  const tool = pathname.match(/^\/v1\/([\w-]+)$/)?.[1];
  if (tool) {
    const handler = TOOLS[tool];
    if (!handler) throw new HttpError(404, `없는 도구입니다: ${tool}`);
    if (method !== "POST") throw new HttpError(405, "POST만 지원합니다");
    await authenticate(request, env);
    return json(await handler(request, env));
  }

  if (pathname === "/admin/keys" || pathname.startsWith("/admin/keys/")) {
    await requireAdmin(request, env);
    const id = pathname.split("/")[3];
    if (method === "GET" && !id) return json({ keys: await listKeys(env) });
    if (method === "POST" && !id) return json(await createKey(env, await request.json().catch(() => ({}))), 201);
    if (method === "DELETE" && id) {
      await deleteKey(env, id);
      return json({ deleted: id });
    }
    throw new HttpError(405, "지원하지 않는 메서드입니다");
  }

  throw new HttpError(404, "없는 경로입니다");
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "서버 오류" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
