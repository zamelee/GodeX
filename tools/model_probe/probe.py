# probe.py - Model Probe Tool with NiceGUI
import sys
import os
import argparse
import threading
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent))

from nicegui import ui
from yaml_ops import YamlOps
from detector import ModelDetector, ProbeResult

class AppState:
    def __init__(self):
        self.yaml_ops = None
        self.models = []
        self.providers = []
        self.selected_provider = None
        self.selected_models = []
        self.is_running = False
        self.stop_event = threading.Event()
        self.log_lines = []
        self.results = {}

app_state = AppState()

def log_to_textarea(message: str):
    app_state.log_lines.append(message)
    if len(app_state.log_lines) > 500:
        app_state.log_lines = app_state.log_lines[-500:]
    log_textarea.value = "\n".join(app_state.log_lines)

def load_config(config_path: str):
    try:
        app_state.yaml_ops = YamlOps(config_path)
        data = app_state.yaml_ops.load()
        app_state.providers = app_state.yaml_ops.get_providers()
        app_state.models = app_state.yaml_ops.get_enabled_models()
        provider_select.options = app_state.providers
        provider_select.update()
        update_model_list()
        ui.notify("Loaded {} models, {} providers".format(len(app_state.models), len(app_state.providers)), type="positive")
    except Exception as e:
        ui.notify("Failed to load config: " + str(e), type="negative")

def on_provider_selected(e):
    if e.value:
        app_state.selected_provider = e.value
        update_model_list()

def update_model_list():
    model_list_container.clear()
    with model_list_container:
        if not app_state.selected_provider:
            ui.label("Select a provider first").classes("text-grey-6")
            return
        filtered_models = [m for m in app_state.models if m.get("provider") == app_state.selected_provider]
        if not filtered_models:
            ui.label("No models for " + app_state.selected_provider).classes("text-grey-6")
            return
        for model in filtered_models:
            model_name = model.get("model", "unknown")
            context_window = model.get("context_window", 0)
            with ui.row().classes("items-center"):
                ui.checkbox(model_name)
                ui.label("ctx=" + str(context_window // 1000) + "K").classes("text-grey-6 text-sm q-ml-sm")

def run_probe_thread():
    def do_probe():
        app_state.is_running = True
        app_state.results = {}
        app_state.stop_event.clear()
        
        def log_callback(msg):
            log_to_textarea(msg)
        
        selected_caps = []
        if ctx_checkbox.value:
            selected_caps.append("context_window")
        if max_tokens_checkbox.value:
            selected_caps.append("max_tokens")
        if text_checkbox.value:
            selected_caps.append("text")
        if image_checkbox.value:
            selected_caps.append("image")
        if function_checkbox.value:
            selected_caps.append("function")
        if reasoning_checkbox.value:
            selected_caps.append("reasoning")
        
        if not selected_caps:
            log_to_textarea("[ERROR] No capabilities selected!")
            app_state.is_running = False
            return
        
        log_to_textarea("=== Starting probe ===")
        
        if not app_state.selected_provider or not app_state.yaml_ops:
            log_to_textarea("[ERROR] No provider selected!")
            app_state.is_running = False
            return
        
        prov_config = app_state.yaml_ops.get_provider_config(app_state.selected_provider)
        if not prov_config:
            log_to_textarea("[ERROR] Provider not found!")
            app_state.is_running = False
            return
        
        base_url = prov_config.get("endpoint", {}).get("base_url", "")
        api_key = prov_config.get("credentials", {}).get("api_key", "")
        timeout = prov_config.get("timeout_ms", 30000) // 1000
        
        if not base_url or not api_key:
            log_to_textarea("[ERROR] Missing base_url or api_key")
            app_state.is_running = False
            return
        
        log_to_textarea("Provider: " + app_state.selected_provider)
        log_to_textarea("API Base: " + base_url)
        
        filtered_models = [m for m in app_state.models if m.get("provider") == app_state.selected_provider]
        
        if not filtered_models:
            log_to_textarea("[ERROR] No models to probe!")
            app_state.is_running = False
            return
        
        for model in filtered_models:
            if app_state.stop_event.is_set():
                log_to_textarea("[STOPPED]")
                break
            
            model_name = model.get("model")
            claimed_context = model.get("context_window", 100000)
            
            log_to_textarea("")
            log_to_textarea("--- Probing " + model_name + " ---")
            
            detector = ModelDetector(base_url, api_key, timeout)
            results = detector.probe_model(model_name, claimed_context, selected_caps, log_callback)
            app_state.results[model_name] = results
            
            if not app_state.stop_event.is_set():
                updates = {}
                for cap, result in results.items():
                    if result.success:
                        updates[cap] = result.value
                
                if updates and app_state.yaml_ops:
                    app_state.yaml_ops.update_model(app_state.selected_provider, model_name, updates)
                    log_to_textarea("[SAVED] " + model_name + ": " + str(updates))
        
        log_to_textarea("")
        log_to_textarea("=== Probe Complete ===")
        app_state.is_running = False
    
    thread = threading.Thread(target=do_probe, daemon=True)
    thread.start()

def stop_probe():
    app_state.stop_event.set()
    log_to_textarea("[STOPPING...]")

with ui.header().classes("items-center q-px-md"):
    ui.label("Model Probe").classes("text-h6")
    ui.space()
    config_input = ui.input(
        label="Config Path",
        placeholder="D:/Documents/VibeCoding/GodeX/godex.yaml"
    ).classes("w-64").props("dense outlined")
    def on_load_config():
        path = config_input.value.strip()
        if path:
            load_config(path)
    ui.button("Load", on_click=on_load_config).props("dense")
    ui.separator().props("vertical")
    with ui.row().classes("items-center"):
        ui.label("Provider:").classes("text-grey-6")
        global provider_select
        provider_select = ui.select(
            label="Provider",
            options=[],
            value=None,
            on_change=on_provider_selected
        ).props("dense outlined")

with ui.row().classes("w-full q-pa-md gap-4"):
    with ui.column().classes("w-80"):
        ui.label("Models").classes("text-h6 q-mb-md")
        with ui.card().classes("w-full"):
            global model_list_container
            model_list_container = ui.column()
            ui.label("Select a provider to see models").classes("text-grey-6")
        
        ui.label("Capabilities").classes("text-h6 q-mt-md q-mb-sm")
        with ui.card().classes("w-full"):
            global ctx_checkbox, max_tokens_checkbox
            global text_checkbox, image_checkbox
            global function_checkbox, reasoning_checkbox
            ctx_checkbox = ui.checkbox("Context Window", value=True)
            max_tokens_checkbox = ui.checkbox("Max Output Tokens", value=True)
            ui.separator()
            text_checkbox = ui.checkbox("Text Support", value=True)
            image_checkbox = ui.checkbox("Image/Vision", value=True)
            ui.separator()
            function_checkbox = ui.checkbox("Function Calling", value=True)
            reasoning_checkbox = ui.checkbox("Reasoning", value=False)
        
        with ui.row().classes("q-mt-md gap-2"):
            ui.button("Start Probe", on_click=run_probe_thread).props("color=primary")
            ui.button("Stop", on_click=stop_probe).props("color=negative")
    
    with ui.column().classes("flex-grow"):
        ui.label("Logs").classes("text-h6 q-mb-md")
        global log_textarea
        log_textarea = ui.textarea(value="")
        log_textarea.props("rows=25 readonly")

parser = argparse.ArgumentParser()
parser.add_argument("--config", "-c", type=str)
args = parser.parse_args()

if args.config:
    config_input.value = args.config
    ui.timer(0.5, lambda: load_config(args.config), once=True)

ui.run(title="Model Probe", port=8080, reload=False, show=False)
