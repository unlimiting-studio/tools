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
