#!/usr/bin/env node
// API 키 관리. TOOLS_ADMIN_TOKEN 환경변수가 필요하다.
//   node scripts/keys.mjs create <name> [--origin https://a.com]... [--app com.example.app]...
//   node scripts/keys.mjs list
//   node scripts/keys.mjs delete <id>
const base = process.env.TOOLS_BASE_URL ?? "https://tools.yechanny.workers.dev";
const token = process.env.TOOLS_ADMIN_TOKEN;
if (!token) {
  console.error("TOOLS_ADMIN_TOKEN 환경변수가 필요합니다");
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${data.error}`);
  return data;
};

const flags = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));

if (cmd === "create" && args[0]) {
  const k = await call("POST", "/admin/keys", { name: args[0], origins: flags("--origin"), appIds: flags("--app") });
  console.log(JSON.stringify(k, null, 2));
  console.error("\n키 원문은 지금만 볼 수 있습니다. 안전한 곳에 저장하세요.");
} else if (cmd === "list") {
  console.table((await call("GET", "/admin/keys")).keys);
} else if (cmd === "delete" && args[0]) {
  console.log(await call("DELETE", `/admin/keys/${args[0]}`));
} else {
  console.error("usage: keys.mjs create <name> [--origin URL]... [--app ID]... | list | delete <id>");
  process.exit(1);
}
