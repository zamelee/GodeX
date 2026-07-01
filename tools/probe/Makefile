# fixtures / upstreams / studio-cdp
PROBE_ROOT := D:\Documents\VibeCoding\GodeX\tools\probe
FIXTURES   := $(PROBE_ROOT)\fixtures
UPSTREAM   := $(PROBE_ROOT)\upstream
STUDIO_CDP := $(PROBE_ROOT)\studio-cdp

# Regenerate image/audio/video fixtures (run from repo root)
fixtures:
	python $(PROBE_ROOT)\generate_fixtures.py --out $(FIXTURES)

# Run all probe scripts against the live minnimax.chat endpoint
probe:
	python $(UPSTREAM)\probe-minnimax.py
	python $(UPSTREAM)\probe-minnimax-caps.py
	python $(UPSTREAM)\probe-minnimax-tools.py

# Standalone Rust probe sanity test (no Tauri, no studio)
cargo-probe:
	cd studio-tauri\src-tauri && cargo run --release --example test_probe

# Build studio + model-probe
studio-build:
	cd studio-tauri\src-tauri && cargo build --release
	cd studio-tauri\model-probe\src-tauri && cargo build --release