// src/config/schema.ts

import type { ProviderRuntimeConfig as BridgeProviderRuntimeConfig } from "../bridge/provider-spec";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface ServerConfig {
	port: number;
	host: string;
	idle_timeout?: number;
}

export type ProviderRuntimeConfig = BridgeProviderRuntimeConfig;

export type ProviderConfig = ProviderRuntimeConfig;

export interface LegacyProviderFactoryConfig {
	api_key: string;
	base_url: string;
	timeout_ms?: number;
}

export interface ModelCapabilities {
	text?: boolean;
	image_input?: boolean;
	audio_input?: boolean;
	video_input?: boolean;
	image_output?: boolean;
	audio_output?: boolean;
	tool_use?: boolean;
	stream?: boolean;
}

export interface EnabledModel {
	provider: string;
	model: string;
	context_window?: number;
	max_tokens?: number;
	multimodal?: boolean;
	capabilities?: ModelCapabilities;
	note?: string;
}

export interface ModelsConfig {
	aliases?: Record<string, string>;
	enabled?: EnabledModel[];
}

export interface SessionConfig {
	backend: "memory" | "sqlite";
	sqlite?: { path: string };
}

export interface ConsoleLoggingConfig {
	enabled: boolean;
	level?: LogLevel;
}

export interface FileLoggingConfig {
	enabled: boolean;
	level?: LogLevel;
	dir: string;
	filename: string;
	max_size?: number;
	max_files?: number;
}

export interface LoggingConfig {
	level: LogLevel;
	console?: ConsoleLoggingConfig;
	file?: FileLoggingConfig;
}

export interface TraceConfig {
	enabled: boolean;
	path: string;
	max_queue_size: number;
	flush_interval_ms: number;
	batch_size: number;
	capture_payload: boolean;
	payload_max_bytes: number;
}

export interface PluginsConfig {
	paths: string[];
}

export interface GodeXConfig {
	server: ServerConfig;
	default_provider: string;
	models?: ModelsConfig;
	providers: Record<string, ProviderConfig>;
	session: SessionConfig;
	logging: LoggingConfig;
	trace: TraceConfig;
	plugins?: PluginsConfig;
}
