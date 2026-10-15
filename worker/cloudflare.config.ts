import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "tools",
		compatibilityDate: "2026-10-01",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
		env: {
			OPENROUTER_API_KEY: bindings.secret(),
			ADMIN_TOKEN: bindings.secret(),
			// /demo 페이지에 넣는 키 (이 Worker의 Origin에서만 쓰도록 발급)
			DEMO_API_KEY: bindings.secret(),
			KEYS: bindings.kv({}),
			// API 키별 분당 호출 한도
			RATE_LIMITER: bindings.rateLimit({
				namespace: "1001",
				simple: {
					limit: 60,
					period: 60,
				},
			}),
		},
	},
});
