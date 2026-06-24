import { describe, expect, test } from "bun:test";
import type { GodeXConfig } from "../../config";
import { ApplicationContext } from "../../context/application-context";
import { Registrar } from "../../providers/registrar";
import { createTestProviderEdge } from "../../testing/provider-edge";
import { handlePaths } from "./paths";

const baseConfig: GodeXConfig = {
	server: { port: 0, host: "127.0.0.1" },
	default_provider: "zhipu",
	providers: {
		zhipu: {
			spec: "zhipu",
			credentials: { api_key: "test-key" },
			endpoint: { base_url: "http://127.0.0.1:1" },
		},
	},
	session: { backend: "memory" },
	logging: { level: "error" },
	trace: {
		enabled: false,
		path: "./data/trace.db",
		max_queue_size: 10000,
		flush_interval_ms: 1000,
		batch_size: 100,
		capture_payload: false,
		payload_max_bytes: 65536,
	},
};

function createTestApp(configPath?: string): ApplicationContext {
	const registrar = new Registrar();
	registrar.registerFactory("zhipu", () =>
		createTestProviderEdge({ name: "zhipu" }),
	);
	return new ApplicationContext(baseConfig, registrar, [], configPath);
}

describe("GET /admin/paths", () => {
	test("reports config_path, session_db_path, trace_db_path, server fields", async () => {
		const res = handlePaths(createTestApp("/tmp/godex-test.yaml"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			config_path: string;
			session_db_path: string | null;
			trace_db_path: string;
			server_port: number;
			server_host: string;
			env: "dev" | "prod";
		};
		expect(body.config_path).toBe("/tmp/godex-test.yaml");
		expect(body.session_db_path).toBeNull(); // memory backend
		expect(body.trace_db_path).toBe("./data/trace.db");
		expect(body.server_port).toBe(0);
		expect(body.server_host).toBe("127.0.0.1");
	});

	test("session_db_path is reported when sqlite backend is configured", async () => {
		const cfg: GodeXConfig = {
			...baseConfig,
			session: { backend: "sqlite", sqlite: { path: "/tmp/godex-sessions.db" } },
		};
		const registrar = new Registrar();
		registrar.registerFactory("zhipu", () => createTestProviderEdge({ name: "zhipu" }));
		const app = new ApplicationContext(cfg, registrar, [], "/tmp/godex.yaml");
		const res = handlePaths(app);
		const body = (await res.json()) as { session_db_path: string | null };
		expect(body.session_db_path).toBe("/tmp/godex-sessions.db");
	});

	test("config_path falls back to <unknown> when not provided", async () => {
		const res = handlePaths(createTestApp());
		const body = (await res.json()) as { config_path: string };
		expect(body.config_path).toBe("<unknown>");
	});

	test("env is 'dev' for src/ paths and 'prod' otherwise", async () => {
		const devRes = handlePaths(createTestApp("/some/repo/src/config.yaml"));
		const devBody = (await devRes.json()) as { env: string };
		expect(devBody.env).toBe("dev");

		const prodRes = handlePaths(createTestApp("/home/user/.godex/config.yaml"));
		const prodBody = (await prodRes.json()) as { env: string };
		expect(prodBody.env).toBe("prod");
	});
});
