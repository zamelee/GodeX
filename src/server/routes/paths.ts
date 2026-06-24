import type { ApplicationContext } from "../../context/application-context";

export interface PathsResponse {
	config_path: string;
	session_db_path: string | null;
	trace_db_path: string;
	server_port: number;
	server_host: string;
	env: "dev" | "prod";
}

/**
 * GET /admin/paths
 *
 * Reports the on-disk locations used by this godex instance so management
 * tools (Studio) can discover session.db, trace.db, and the active config
 * without hardcoded paths or env-var guessing.
 */
export function handlePaths(app: ApplicationContext): Response {
	const sessionBackend = app.config.session.backend;
	const sessionDbPath =
		sessionBackend === "sqlite"
			? (app.config.session.sqlite?.path ?? null)
			: null;
	return Response.json({
		config_path: app.configPath ?? "<unknown>",
		session_db_path: sessionDbPath,
		trace_db_path: app.config.trace.path,
		server_port: app.config.server.port,
		server_host: app.config.server.host,
		env: app.configPath && app.configPath.includes("/src/") ? "dev" : "prod",
	});
}
