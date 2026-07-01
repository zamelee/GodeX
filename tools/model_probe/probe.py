# probe.py - Model Probe Tool with NiceGUI
import sys
import os
import argparse
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from nicegui import ui
from yaml_ops import YamlOps
from detector import ModelDetector, ProbeResult

# Dark theme CSS
ui.add_css("""
body { background: #0d1117; color: #e6edf3; }
.probe-header { background: #161b22; border-bottom: 1px solid #30363d; padding: 10px 20px; display: flex; align-items: center; gap: 12px; }
.probe-title { font-size: 18px; font-weight: 600; color: #ffffff; }
.probe-main { flex: 1; display: flex; overflow: hidden; }
.probe-left { width: 280px; min-width: 200px; background: #0d1117; display: flex; flex-direction: column; }
.probe-right { flex: 1; background: #0d1117; display: flex; flex-direction: column; overflow: hidden; }
.section-label { font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.model-item { background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 6px 10px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
.model-item:hover { background: #30363d; }
.model-name { font-size: 13px; color: #ffffff; }
.model-params { font-size: 11px; color: #58a6ff; }
.logs { background: #0d1117; display: flex; flex-direction: column; }
.logs-header { background: #161b22; border-bottom: 1px solid #30363d; padding: 6px 12px; display: flex; align-items: center; justify-content: space-between; }
.logs-title { font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; }
.logs-content { flex: 1; overflow-y: auto; padding: 8px 12px; font-family: Consolas, monospace; font-size: 11px; color: #7ee787; line-height: 1.4; white-space: pre-wrap; word-break: break-all; }
.v-sash { background: #30363d; width: 4px; cursor: col-resize; flex-shrink: 0; }
.v-sash:hover { background: #484f58; }
.cap-hint { font-size: 9px; color: #6e7681; margin-left: 22px; }
/* Input text color */
/* Input text */
input[type="text"] { color: #ffffff !important; background: #21262d !important; }
input.q-field__native { color: #ffffff !important; }
input.q-field__input { color: #ffffff !important; }
input.q-field__native span { color: #ffffff !important; }
/* Select dropdown menu - force dark */
.q-menu { background: #21262d !important; border: 1px solid #30363d !important; box-shadow: 0 4px 8px rgba(0,0,0,0.4) !important; }
.q-menu .q-item { background: #21262d !important; color: #ffffff !important; min-height: 40px !important; }
.q-menu .q-item:hover { background: #30363d !important; }
.q-menu .q-item__label { color: #ffffff !important; }
.q-menu .q-virtual-scroll__content { background: #21262d !important; }
""")

class AppState:
    def __init__(self):
        self.yaml_ops = None
        self.models = []
        self.providers = []
        self.selected_provider = None
        self.is_running = False
        self.stop_event = threading.Event()
        self.log_lines = []

app_state = AppState()

def log(msg):
    app_state.log_lines.append(msg)
    if len(app_state.log_lines) > 1000:
        app_state.log_lines = app_state.log_lines[-1000:]
    log_textarea.text = "\n".join(app_state.log_lines)

def load_config(path):
    try:
        app_state.yaml_ops = YamlOps(path)
        app_state.yaml_ops.load()
        app_state.providers = app_state.yaml_ops.get_providers()
        app_state.models = app_state.yaml_ops.get_enabled_models()
        provider_select.options = app_state.providers
        provider_select.update()
        update_models()
        log("[OK] Loaded " + str(len(app_state.models)) + " models")
    except Exception as e:
        log("[ERROR] " + str(e))

def on_provider_change(e):
    if e.value:
        app_state.selected_provider = e.value
        update_models()

def update_models():
    model_list.clear()
    with model_list:
        if not app_state.selected_provider:
            ui.label("Select provider").style("color: #8b949e; font-size: 12px;")
            return
        filtered = [m for m in app_state.models if m.get("provider") == app_state.selected_provider]
        if not filtered:
            ui.label("No models").style("color: #8b949e; font-size: 12px;")
            return
        for model in filtered:
            name = model.get("model", "?")
            ctx = model.get("context_window", 0)
            out = model.get("max_tokens", 0)
            ctx_str = str(ctx // 1000) + "K" if ctx else "?"
            out_str = str(out // 1000) + "K" if out else "?"
            with ui.element("div").style("background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 6px 10px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;"):
                ui.label(name).style("color: #ffffff; font-size: 13px;")
                ui.label(ctx_str + " / " + out_str).style("color: #58a6ff; font-size: 11px;")

def on_file_upload(e):
    if e.files:
        path = e.files[0].name
        config_input.value = path
        load_config(path)

async def open_file_dialog():
    await ui.run_javascript("document.querySelector('.file-input input').click();")

def run_probe():
    def do():
        app_state.is_running = True
        app_state.stop_event.clear()
        
        caps = []
        labels = []
        if ctx_cb.value: caps.append("context_window"); labels.append("Context")
        if maxout_cb.value: caps.append("max_tokens"); labels.append("MaxOut")
        if text_cb.value: caps.append("text"); labels.append("Text")
        if image_cb.value: caps.append("image"); labels.append("Image")
        if func_cb.value: caps.append("function"); labels.append("Function")
        if reason_cb.value: caps.append("reasoning"); labels.append("Reasoning")
        if comp_cb.value: caps.append("computer"); labels.append("Computer")
        if tsearch_cb.value: caps.append("tool_search"); labels.append("ToolSearch")
        if wsearch_cb.value: caps.append("web_search"); labels.append("WebSearch")
        if fsearch_cb.value: caps.append("file_search"); labels.append("FileSearch")
        if mcp_cb.value: caps.append("mcp"); labels.append("MCP")
        
        if not caps:
            log("[ERROR] No capabilities selected!")
            app_state.is_running = False
            return
        
        log("=== Probe: " + ", ".join(labels) + " ===")
        
        if not app_state.selected_provider or not app_state.yaml_ops:
            log("[ERROR] No provider selected!")
            app_state.is_running = False
            return
        
        cfg = app_state.yaml_ops.get_provider_config(app_state.selected_provider)
        if not cfg:
            log("[ERROR] Provider not found!")
            app_state.is_running = False
            return
        
        base_url = cfg.get("endpoint", {}).get("base_url", "")
        api_key = cfg.get("credentials", {}).get("api_key", "")
        timeout = cfg.get("timeout_ms", 30000) // 1000
        
        if not base_url or not api_key:
            log("[ERROR] Missing base_url or api_key")
            app_state.is_running = False
            return
        
        log("Provider: " + app_state.selected_provider)
        log("Base: " + base_url)
        
        filtered = [m for m in app_state.models if m.get("provider") == app_state.selected_provider]
        
        for model in filtered:
            if app_state.stop_event.is_set():
                log("[STOPPED]")
                break
            name = model.get("model")
            claimed = model.get("context_window", 100000)
            log("")
            log("--- " + name + " ---")
            detector = ModelDetector(base_url, api_key, timeout)
            results = detector.probe_model(name, claimed, caps, log)
            if not app_state.stop_event.is_set():
                updates = {}
                for cap, result in results.items():
                    if result.success and result.value is not None:
                        updates[cap] = result.value
                if updates:
                    log("[PREVIEW] " + str(updates))
                    results_label.text = str(updates)
        
        log("")
        log("=== Done - Review results above, then click Save ===")
        app_state.is_running = False
        ui.timer(0.3, update_models, once=True)
    
    threading.Thread(target=do, daemon=True).start()

def stop_probe():
    app_state.stop_event.set()
    log("[STOPPING...]")

# Layout
with ui.element("div").style("height: 100vh; display: flex; flex-direction: column; background: #0d1117;"):
    # Header
    with ui.element("div").style("background: #161b22; border-bottom: 1px solid #30363d; padding: 10px 20px; display: flex; align-items: center; gap: 12px;"):
        ui.label("Model Probe").style("font-size: 18px; font-weight: 600; color: #ffffff;")
        config_input = ui.input(label="Config", placeholder="godex.yaml path").props("dense outlined").style("flex: 1; min-width: 200px; --q-primary: #ffffff; color: #ffffff;")
        with ui.element("div").style("position: relative;"):
            ui.upload(on_upload=on_file_upload, auto_upload=True).props("accept .yaml,.yml").style("position: absolute; opacity: 0; width: 40px; height: 40px; cursor: pointer;").classes("file-input")
            ui.button(icon="folder_open", on_click=open_file_dialog).props("dense flat")

    # Main content
    with ui.element("div").style("flex: 1; display: flex; overflow: hidden;"):
        # Left panel
        with ui.element("div").style("width: 280px; min-width: 200px; background: #0d1117; display: flex; flex-direction: column;"):
            # Provider
            with ui.element("div").style("background: #161b22; border-bottom: 1px solid #30363d; padding: 12px;"):
                ui.label("Provider").style("font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;")
                global provider_select
                provider_select = ui.select(options=[], value=None, on_change=on_provider_change).props("dense outlined use-chips").style("width: 100%;")
            
            # Models
            with ui.element("div").style("flex: 1; background: #0d1117; padding: 12px; overflow: hidden; display: flex; flex-direction: column;"):
                ui.label("Models").style("font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;")
                global model_list
                model_list = ui.column()
                model_list.style("flex: 1; overflow-y: auto;")
                ui.label("Select provider").style("color: #8b949e; font-size: 12px;")
        
        # Vertical sash
        ui.element("div").style("background: #30363d; width: 4px; cursor: col-resize; flex-shrink: 0;")
        
        # Right panel
        with ui.element("div").style("flex: 1; background: #0d1117; display: flex; flex-direction: column; overflow: hidden;"):
            # Capabilities card
            with ui.element("div").style("background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin: 8px; flex-shrink: 0;"):
                ui.label("Capabilities").style("font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;")
                
                # Row 1 - Context & Max Output (stacked inside row)
                with ui.row().style("gap: 24px; margin-bottom: 8px;"):
                    with ui.column():
                            global ctx_cb
                            ctx_cb = ui.checkbox("Context Window", value=True)
                            ui.label("max_tokens").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global maxout_cb
                            maxout_cb = ui.checkbox("Max Output", value=True)
                            ui.label("max_tokens").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                
                ui.separator().style("background: #30363d; margin: 8px 0;")
                
                # Row 2
                ui.label("Input/Output").style("font-size: 10px; color: #8b949e; margin-bottom: 6px;")
                with ui.row().style("gap: 24px; margin-bottom: 8px;"):
                    with ui.column():
                            global text_cb
                            text_cb = ui.checkbox("Text", value=True)
                            ui.label("messages.content").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global image_cb
                            image_cb = ui.checkbox("Image", value=True)
                            ui.label("content[image_url]").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global reason_cb
                            reason_cb = ui.checkbox("Reasoning", value=True)
                            ui.label("reasoning_effort").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                
                ui.separator().style("background: #30363d; margin: 8px 0;")
                
                # Row 3 - Tools
                ui.label("Tools").style("font-size: 10px; color: #8b949e; margin-bottom: 6px;")
                with ui.row().style("gap: 16px; flex-wrap: wrap;"):
                    with ui.column():
                            global func_cb
                            func_cb = ui.checkbox("Function", value=True)
                            ui.label("tools[type=function]").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global comp_cb
                            comp_cb = ui.checkbox("Computer", value=False)
                            ui.label("tools[type=computer]").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global tsearch_cb
                            tsearch_cb = ui.checkbox("Tool Search", value=False)
                            ui.label("tool_choice").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global wsearch_cb
                            wsearch_cb = ui.checkbox("Web Search", value=False)
                            ui.label("tools[type=web_search]").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global fsearch_cb
                            fsearch_cb = ui.checkbox("File Search", value=False)
                            ui.label("tools[type=file_search]").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
                    with ui.column():
                            global mcp_cb
                            mcp_cb = ui.checkbox("MCP", value=False)
                            ui.label("mcp servers").style("font-size: 9px; color: #6e7681; margin-top: 0; padding-top: 0; line-height: 1;")
            
            # Results preview table
            with ui.element("div").style("background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin: 8px; flex-shrink: 0;"):
                ui.label("Preview Results").style("font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;")
                global results_label
                results_label = ui.label("No results yet").style("color: #6e7681; font-size: 11px;")
            
            # Buttons
            with ui.row().style("margin: 0 8px; gap: 8px; flex-shrink: 0;"):
                ui.button("Start Probe", on_click=run_probe, icon="play_arrow").props("color=primary")
                ui.button("Stop", on_click=stop_probe, icon="stop").props("color=negative flat")
                ui.button("Save Results", on_click=lambda: ui.notify("Save clicked - would save results", type="info")).props("color=positive")
            
            # Logs
            with ui.element("div").style("flex: 1; background: #0d1117; display: flex; flex-direction: column; overflow: hidden; min-height: 100px;"):
                with ui.element("div").style("background: #161b22; border-top: 1px solid #30363d; padding: 6px 12px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;"):
                    ui.label("Logs").style("font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase;")
                    ui.button(icon="clear", on_click=lambda: (app_state.log_lines.clear(), log(""))).props("dense flat round")
                with ui.element("div").style("flex: 1; overflow-y: auto; padding: 8px 12px;"):
                    global log_textarea
                    log_textarea = ui.label("")
                    log_textarea.style("font-family: Consolas, monospace; font-size: 11px; color: #7ee787; line-height: 1.4; white-space: pre-wrap; word-break: break-all; margin: 0;")

# Args
parser = argparse.ArgumentParser()
parser.add_argument("--config", "-c", type=str)
args = parser.parse_args()

if args.config:
    config_input.value = args.config
    ui.timer(0.3, lambda: load_config(args.config), once=True)

ui.run(title="Model Probe", port=8080, reload=False, show=False)

