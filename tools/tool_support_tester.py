# -*- coding: utf-8 -*-
# Tool Support Tester v6.0
import tkinter as tk
from tkinter import ttk
import urllib.request, urllib.error, json, threading, os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")

TOOLS = [
    ("tool_search", "Tool Search", "Tool discovery", "search available tools"),
    ("web_search", "Web Search", "Web search", "search internet"),
    ("computer_use", "Computer Use", "Computer control", "screenshot/click/type"),
    ("apply_patch", "Apply Patch", "Code patch", "apply diff patch"),
    ("local_shell", "Local Shell", "Local command", "run local cmd"),
    ("shell", "Shell", "Shell command", "run shell"),
]

PROMPTS = {
    "tool_search": "call tool_search to discover your available tools.",
    "web_search": "search for hot news.",
    "computer_use": "take a screenshot.",
    "apply_patch": "apply a patch.",
    "local_shell": "run ls or dir.",
    "shell": "run a shell command.",
}

THEME = {
    "bg": "#0f0f23", "bg2": "#1a1a3e", "bg3": "#252550",
    "text": "#e0e0ff", "text2": "#8888aa",
    "accent": "#7c3aed", "accent2": "#a78bfa",
    "success": "#10b981", "fail": "#ef4444",
    "warn": "#f59e0b", "info": "#3b82f6",
}

CC_SCHEMAS = {
    "tool_search": {"type": "function", "function": {"name": "tool_search", "description": "search tools", "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "number"}}, "required": ["query"]}}},
    "web_search": {"type": "function", "function": {"name": "web_search", "description": "web search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    "computer_use": {"type": "function", "function": {"name": "computer_use", "description": "computer control", "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["screenshot", "click", "type", "keypress", "scroll", "move", "drag", "wait"]}, "x": {"type": "number"}, "y": {"type": "number"}, "text": {"type": "string"}, "keys": {"type": "array", "items": {"type": "string"}}}, "required": ["action"]}}},
    "apply_patch": {"type": "function", "function": {"name": "apply_patch", "description": "patch", "parameters": {"type": "object", "properties": {"input": {"type": "string"}}, "required": ["input"]}}},
    "local_shell": {"type": "function", "function": {"name": "local_shell", "description": "local cmd", "parameters": {"type": "object", "properties": {"cmd": {"type": "array", "items": {"type": "string"}}}, "required": ["cmd"]}}},
    "shell": {"type": "function", "function": {"name": "shell", "description": "shell", "parameters": {"type": "object", "properties": {"commands": {"type": "array", "items": {"type": "string"}}}, "required": ["commands"]}}},
}

RESP_SCHEMAS = {
    "tool_search": {"type": "tool_search", "description": "search available tools"},
    "web_search": {"type": "web_search", "description": "web search"},
    "computer_use": {"type": "computer_use", "description": "computer control"},
    "local_shell": {"type": "local_shell", "description": "run local command"},
    "shell": {"type": "shell", "description": "run shell command"},
}

class ToolTester(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Tool Support Tester v6.0")
        self.geometry("1300x900")
        self.minsize(1200, 800)
        self.configure(bg=THEME["bg"])
        self.api_type = tk.StringVar(value="chat_completions")
        self.providers = {}
        self.selected_provider = tk.StringVar(value="default")
        self.models = []
        self.selected_tool = tk.StringVar(value="tool_search")
        self.status_var = tk.StringVar(value="Ready")
        self.testing = False
        self.unsaved = False
        self.create_widgets()
        self.load_config()

    def create_widgets(self):
        hdr = tk.Frame(self, bg=THEME["accent"], height=70)
        hdr.pack(fill=tk.X)
        hdr.pack_propagate(False)
        tk.Label(hdr, text="Tool Support Tester v6.0", bg=THEME["accent"], fg="white",
                font=("Segoe UI", 22, "bold")).pack(side=tk.LEFT, padx=25, pady=15)
        tk.Label(hdr, text="Model Tool Support Test  |  Chat Completions + Responses API",
                bg=THEME["accent"], fg="#c4b5fd", font=("Segoe UI", 10)).pack(side=tk.LEFT, padx=15, pady=25)

        main = tk.Frame(self, bg=THEME["bg"])
        main.pack(fill=tk.BOTH, expand=True, padx=20, pady=15)

        # API Config
        cfg = tk.Frame(main, bg=THEME["bg2"])
        cfg.pack(fill=tk.X, pady=(0, 15))
        tk.Label(cfg, text="API Configuration", bg=THEME["bg2"], fg=THEME["accent2"],
                font=("Segoe UI", 11, "bold")).pack(anchor=tk.W, padx=15, pady=(10, 5))

        r1 = tk.Frame(cfg, bg=THEME["bg2"])
        r1.pack(fill=tk.X, padx=15, pady=(0, 8))
        tk.Label(r1, text="Provider:", bg=THEME["bg2"], fg=THEME["text2"],
                font=("Segoe UI", 9)).grid(row=0, column=0, sticky=tk.W, padx=(0, 6))
        self.prov_combo = ttk.Combobox(r1, textvariable=self.selected_provider,
                values=["default"], state="readonly", width=18, font=("Segoe UI", 9))
        self.prov_combo.grid(row=0, column=1, sticky=tk.W, padx=(0, 12))
        self.prov_combo.bind("<<ComboboxSelected>>", lambda e: self.on_provider_select())
        for i, (txt, cmd, color) in enumerate([("+ Add", self.add_provider, THEME["accent"]),
                                                  ("Save", self.save_provider, THEME["success"]),
                                                  ("Delete", self.del_provider, THEME["fail"])]):
            tk.Button(r1, text=txt, command=cmd, bg=color, fg="white", relief=tk.FLAT,
                     font=("Segoe UI", 9), padx=8).grid(row=0, column=2+i, sticky=tk.W, padx=(0, 15))

        tk.Label(r1, text="API Type:", bg=THEME["bg2"], fg=THEME["text2"],
                font=("Segoe UI", 9)).grid(row=0, column=5, sticky=tk.W, padx=(0, 6))
        self.api_type.trace_add("write", lambda *a: self.update_endpoint_label())
        for i, (val, lbl) in enumerate([("chat_completions", "Chat Completions"), ("responses_api", "Responses API")]):
            tk.Radiobutton(r1, text=lbl, variable=self.api_type, value=val,
                         bg=THEME["bg2"], fg=THEME["text"], selectcolor=THEME["accent"],
                         activebackground=THEME["bg2"], font=("Segoe UI", 9),
                         command=self.update_endpoint_label).grid(row=0, column=6+i, sticky=tk.W, padx=(0, 8))
        self.endpoint_lbl = tk.Label(r1, text="endpoint: /chat/completions",
                bg=THEME["bg2"], fg=THEME["info"], font=("Consolas", 9))
        self.endpoint_lbl.grid(row=0, column=8, sticky=tk.W)

        r2 = tk.Frame(cfg, bg=THEME["bg2"])
        r2.pack(fill=tk.X, padx=15, pady=(0, 10))
        tk.Label(r2, text="URL:", bg=THEME["bg2"], fg=THEME["text2"],
                font=("Segoe UI", 9)).grid(row=0, column=0, sticky=tk.W, padx=(0, 6))
        self.url_entry = tk.Entry(r2, bg=THEME["bg3"], fg=THEME["text"],
                insertbackground=THEME["text"], font=("Consolas", 9), bd=0, relief=tk.FLAT, width=55)
        self.url_entry.grid(row=0, column=1, sticky=tk.W+tk.E, padx=(0, 20))
        tk.Label(r2, text="Key:", bg=THEME["bg2"], fg=THEME["text2"],
                font=("Segoe UI", 9)).grid(row=0, column=2, sticky=tk.W, padx=(0, 6))
        self.key_entry = tk.Entry(r2, bg=THEME["bg3"], fg=THEME["text"],
                insertbackground=THEME["text"], font=("Consolas", 9), bd=0, relief=tk.FLAT, width=40, show="*")
        self.key_entry.grid(row=0, column=3, sticky=tk.W)
        for e in [self.url_entry, self.key_entry]:
            e.bind("<KeyRelease>", lambda *a: self.set_unsaved())

        # Content
        content = tk.Frame(main, bg=THEME["bg"])
        content.pack(fill=tk.BOTH, expand=True)

        # Left - Tools
        left = tk.Frame(content, bg=THEME["bg2"], width=310)
        left.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 15))
        left.pack_propagate(False)
        tk.Label(left, text="Select Tool", bg=THEME["bg2"], fg=THEME["accent2"],
                font=("Segoe UI", 12, "bold")).pack(padx=15, pady=(15, 10))
        self.tool_frames = {}
        for tool_id, name_en, name_cn, desc in TOOLS:
            fr = tk.Frame(left, bg=THEME["bg3"], cursor="hand2")
            fr.pack(fill=tk.X, padx=10, pady=4)
            inn = tk.Frame(fr, bg=THEME["bg3"])
            inn.pack(fill=tk.X, padx=5, pady=4)
            tk.Radiobutton(inn, variable=self.selected_tool, value=tool_id,
                         bg=THEME["bg3"], fg=THEME["text"], selectcolor=THEME["accent"],
                         activebackground=THEME["bg3"]).pack(side=tk.LEFT)
            txt = tk.Frame(inn, bg=THEME["bg3"])
            txt.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=8)
            tk.Label(txt, text=name_en + "  " + name_cn, bg=THEME["bg3"],
                    fg=THEME["text"], font=("Microsoft YaHei", 10, "bold"), anchor=tk.W).pack(fill=tk.X)
            tk.Label(txt, text=desc, bg=THEME["bg3"], fg=THEME["text2"],
                    font=("Microsoft YaHei", 8), anchor=tk.W).pack(fill=tk.X)
            self.tool_frames[tool_id] = fr

        # Right
        right = tk.Frame(content, bg=THEME["bg"])
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Models
        mdl = tk.Frame(right, bg=THEME["bg2"])
        mdl.pack(fill=tk.BOTH, expand=True, pady=(0, 15))
        mhdr = tk.Frame(mdl, bg=THEME["bg2"])
        mhdr.pack(fill=tk.X, padx=15, pady=(10, 5))
        tk.Label(mhdr, text="Model List", bg=THEME["bg2"], fg=THEME["accent2"],
                font=("Segoe UI", 12, "bold")).pack(side=tk.LEFT)
        tk.Button(mhdr, text="Refresh Models", command=self.fetch_models,
                 bg=THEME["info"], fg="white", relief=tk.FLAT, font=("Segoe UI", 9), padx=10).pack(side=tk.RIGHT)
        lf = tk.Frame(mdl, bg=THEME["bg3"])
        lf.pack(fill=tk.BOTH, expand=True, padx=15, pady=(0, 8))
        sy = tk.Scrollbar(lf); sy.pack(side=tk.RIGHT, fill=tk.Y)
        self.model_list = tk.Listbox(lf, bg=THEME["bg3"], fg=THEME["text"],
                font=("Consolas", 9), selectmode=tk.EXTENDED,
                yscrollcommand=sy.set, bd=0, relief=tk.FLAT, selectbackground=THEME["accent"])
        self.model_list.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sy.config(command=self.model_list.yview)
        br = tk.Frame(mdl, bg=THEME["bg2"])
        br.pack(fill=tk.X, padx=15, pady=(0, 8))
        self.btn_sel = tk.Button(br, text="Test Selected", command=self.test_selected,
                     bg=THEME["accent"], fg="white", relief=tk.FLAT, font=("Segoe UI", 10), padx=15)
        self.btn_sel.pack(side=tk.LEFT, padx=(0, 8))
        self.btn_all = tk.Button(br, text="Test All", command=self.test_all,
                     bg=THEME["accent"], fg="white", relief=tk.FLAT, font=("Segoe UI", 10), padx=15)
        self.btn_all.pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(br, text="Clear Log", command=self.clear_log,
                 bg=THEME["bg3"], fg=THEME["text2"], relief=tk.FLAT,
                 font=("Segoe UI", 9), padx=10).pack(side=tk.RIGHT)

        # Log
        lg = tk.Frame(right, bg=THEME["bg2"])
        lg.pack(fill=tk.BOTH, expand=True)
        tk.Label(lg, text="Test Log", bg=THEME["bg2"], fg=THEME["accent2"],
                font=("Segoe UI", 10, "bold")).pack(anchor=tk.W, padx=15, pady=(8, 5))
        li = tk.Frame(lg, bg=THEME["bg3"])
        li.pack(fill=tk.BOTH, expand=True, padx=15, pady=(0, 10))
        sl = tk.Scrollbar(li); sl.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_area = tk.Text(li, bg=THEME["bg3"], fg=THEME["text"],
                font=("Consolas", 9), wrap=tk.WORD,
                yscrollcommand=sl.set, bd=0, relief=tk.FLAT, state=tk.DISABLED,
                insertbackground=THEME["text"])
        self.log_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sl.config(command=self.log_area.yview)

        # Status
        st = tk.Frame(self, bg=THEME["bg2"], height=30)
        st.pack(fill=tk.X, side=tk.BOTTOM)
        st.pack_propagate(False)
        tk.Label(st, textvariable=self.status_var, bg=THEME["bg2"],
                fg=THEME["text2"], font=("Segoe UI", 9), anchor=tk.W).pack(side=tk.LEFT, padx=15, pady=5)
        self.unsaved_lbl = tk.Label(st, text="", bg=THEME["warn"], font=("Segoe UI", 14))
        self.unsaved_lbl.pack(side=tk.RIGHT, padx=15, pady=5)

    def set_unsaved(self):
        self.unsaved = True
        self.unsaved_lbl.config(text="*")

    def update_endpoint_label(self, *a):
        ep = "/v1/responses" if self.api_type.get() == "responses_api" else "/chat/completions"
        self.endpoint_lbl.config(text="endpoint: " + ep)

    def load_config(self):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            # Handle old format migration: {"api": {"base_url":..., "api_key":...}}
            if "providers" not in cfg and "api" in cfg:
                self.providers = {"default": {"base_url": cfg["api"].get("base_url",""), "api_key": cfg["api"].get("api_key",""), "api_type": "chat_completions"}}
            else:
                self.providers = cfg.get("providers", {})
            if not self.providers:
                self.providers = {"default": {}}
            self.selected_provider.set("default" if "default" in self.providers else next(iter(self.providers)))
            self.update_prov_combo()
            self.on_provider_select()
        except Exception:
            self.providers = {"default": {}}
            self.update_prov_combo()

    def save_config(self):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump({"providers": self.providers}, f, indent=4, ensure_ascii=False)
            self.unsaved = False
            self.unsaved_lbl.config(text="")
            self.status_var.set("Config saved: " + CONFIG_FILE)
        except Exception as e:
            self.status_var.set("Save failed: " + str(e))

    def update_prov_combo(self):
        names = list(self.providers.keys())
        self.prov_combo["values"] = names
        idx = names.index(self.selected_provider.get()) if self.selected_provider.get() in names else 0
        self.prov_combo.current(idx)

    def on_provider_select(self):
        p = self.providers.get(self.selected_provider.get(), {})
        self.url_entry.delete(0, tk.END)
        self.url_entry.insert(0, p.get("base_url", ""))
        self.key_entry.delete(0, tk.END)
        self.key_entry.insert(0, p.get("api_key", ""))
        self.api_type.set(p.get("api_type", "chat_completions"))
        self.update_endpoint_label()

    def add_provider(self):
        top = tk.Toplevel(self)
        top.title("Add Provider")
        top.geometry("350x130")
        top.configure(bg=THEME["bg2"])
        top.grab_set()
        tk.Label(top, text="Provider name:", bg=THEME["bg2"], fg=THEME["text"],
                font=("Segoe UI", 10)).pack(padx=20, pady=(20, 5))
        nv = tk.StringVar()
        tk.Entry(top, textvariable=nv, bg=THEME["bg3"], fg=THEME["text"],
                font=("Segoe UI", 10), bd=0, relief=tk.FLAT,
                insertbackground=THEME["text"]).pack(fill=tk.X, padx=20)
        bf = tk.Frame(top, bg=THEME["bg2"])
        bf.pack(pady=15)
        def do_add():
            name = nv.get().strip()
            if not name or name in self.providers: return
            self.providers[name] = {"base_url": "", "api_key": "", "api_type": "chat_completions"}
            self.update_prov_combo()
            self.selected_provider.set(name)
            self.on_provider_select()
            top.destroy()
        tk.Button(bf, text="OK", command=do_add, bg=THEME["accent"],
                 fg="white", relief=tk.FLAT, font=("Segoe UI", 10), padx=20).pack(side=tk.LEFT, padx=5)
        tk.Button(bf, text="Cancel", command=top.destroy, bg=THEME["bg3"],
                 fg=THEME["text"], relief=tk.FLAT, font=("Segoe UI", 10), padx=20).pack(side=tk.LEFT)

    def save_provider(self):
        name = self.selected_provider.get()
        self.providers[name] = {
            "base_url": self.url_entry.get().strip(),
            "api_key": self.key_entry.get().strip(),
            "api_type": self.api_type.get(),
        }
        self.save_config()

    def del_provider(self):
        if len(self.providers) <= 1:
            self.status_var.set("Keep at least one Provider")
            return
        name = self.selected_provider.get()
        del self.providers[name]
        self.selected_provider.set(next(iter(self.providers)))
        self.update_prov_combo()
        self.on_provider_select()
        self.save_config()

    def fetch_models(self):
        key = self.key_entry.get().strip()
        if not key:
            self.status_var.set("Enter API Key first"); return
        self.status_var.set("Fetching model list...")
        def fetch():
            base = self.url_entry.get().strip().rstrip("/")
            # Avoid double /v1/v1/models when base already ends with /v1
            if base.endswith("/v1"):
                suffixes = ["/models", "/v1/models"]
            else:
                suffixes = ["/v1/models", "/models"]
            # Try multiple model endpoints: /v1/models (GodeX), /models (OpenAI)
            for suffix in suffixes:
                try:
                    url = base + suffix
                    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key})
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        result = json.loads(resp.read().decode())
                    # Support both GodeX {"models":[...]} and OpenAI {"data":[...]} formats
                    raw = result.get("models") or result.get("data") or []
                    models = [m.get("id") or m.get("name") for m in raw if (m.get("id") or m.get("name"))]
                    self.after(0, lambda m=models: self._update_models(m))
                    return
                except Exception:
                    pass
            # All endpoints failed
            self.after(0, lambda: self.status_var.set("Failed: check URL and API Key"))
        threading.Thread(target=fetch, daemon=True).start()

    def _update_models(self, models):
        self.models = models
        self.model_list.delete(0, tk.END)
        for m in models: self.model_list.insert(tk.END, m)
        self.status_var.set("Loaded " + str(len(models)) + " models")

    def get_selected_models(self):
        return [self.models[i] for i in self.model_list.curselection()]

    def test_selected(self):
        models = self.get_selected_models()
        if not models:
            self.status_var.set("Select models first (Ctrl+click to multi-select)"); return
        self.run_tests(models)

    def test_all(self):
        if not self.models:
            self.status_var.set("Fetch model list first"); return
        self.run_tests(self.models)

    def run_tests(self, models):
        tool = self.selected_tool.get()
        api_type = self.api_type.get()
        base_url = self.url_entry.get().strip().rstrip("/")
        api_key = self.key_entry.get().strip()
        if not api_key:
            self.status_var.set("Enter API Key first"); return
        self.testing = True
        self.btn_sel.config(state=tk.DISABLED)
        self.btn_all.config(state=tk.DISABLED)
        self.status_var.set("Testing: " + tool + " [" + str(len(models)) + " models, " + api_type + "]")
        def run():
            self._log("=" * 65, "head")
            self._log("  Tool: " + tool + " - " + PROMPTS.get(tool, ""), "head")
            self._log("  API: " + api_type + " (" + ("/v1/responses" if api_type == "responses_api" else "/chat/completions") + ")", "head")
            self._log("  Models: " + str(len(models)), "head")
            self._log("-" * 65)
            ok, fail, err = 0, 0, 0
            for model in models:
                o, f, e = self._test_single(base_url, api_key, model, tool, api_type)
                ok += o; fail += f; err += e
            self._log("-" * 65)
            self._log("  Result: " + str(ok) + " OK, " + str(fail) + " FAIL, " + str(err) + " ERR", "head")
            self._log("=" * 65, "head")
            def done():
                self.status_var.set("Done: " + str(ok) + " pass, " + str(fail) + " fail")
                self.btn_sel.config(state=tk.NORMAL)
                self.btn_all.config(state=tk.NORMAL)
                self.testing = False
            self.after(0, done)
        threading.Thread(target=run, daemon=True).start()

    def _test_single(self, base_url, api_key, model, tool, api_type):
        endpoint = "/v1/responses" if api_type == "responses_api" else "/chat/completions"
        url = base_url + endpoint
        ok_, fail_, err_ = 0, 0, 0
        if api_type == "responses_api":
            payload = {
                "model": model,
                "input": [{"role": "user", "content": [{"type": "input_text", "text": PROMPTS.get(tool, "")}]}],
                "tools": [RESP_SCHEMAS.get(tool, {"type": tool})],
                "max_output_tokens": 512,
            }
        else:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": PROMPTS.get(tool, "")}],
                "tools": [CC_SCHEMAS.get(tool, {})],
                "max_tokens": 512,
            }
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key}, method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode())
            if "error" in result:
                self._log("  [ERR] " + model + ": " + str(result.get("error", {}).get("message", ""))[:60], "warn")
                return 0, 0, 1
            if api_type == "responses_api":
                items = result.get("output", [])
                types = [i.get("type") for i in items]
                if tool in types or (tool + "_call") in types:
                    self._log("  [ OK] " + model + ": " + str(types), "ok"); return 1, 0, 0
                fc = [i.get("name") or i.get("function", {}).get("name") for i in items if i.get("type") == "function_call"]
                if tool in fc:
                    self._log("  [ OK] " + model + ": " + str(fc), "ok"); return 1, 0, 0
                self._log("  [FAIL] " + model + ": " + str(types or fc or "no tool call"), "fail"); return 0, 1, 0
            else:
                calls = []
                for c in result.get("choices", []):
                    calls.extend(c.get("message", {}).get("tool_calls", []) or [])
                names = [tc.get("function", {}).get("name") for tc in calls]
                if tool in names:
                    self._log("  [ OK] " + model + ": " + str(names), "ok"); return 1, 0, 0
                self._log("  [FAIL] " + model + ": " + str(names or "no tool call"), "fail"); return 0, 1, 0
        except urllib.error.HTTPError as e:
            try: body = e.read().decode()[:100]
            except: body = "(empty body)"
            self._log("  [ERR] " + model + ": HTTP " + str(e.code) + " " + body, "warn"); return 0, 0, 1
        except Exception as e:
            self._log("  [ERR] " + model + ": " + str(e)[:60], "warn"); return 0, 0, 1

    def _log(self, msg, style="normal"):
        colors = {"head": THEME["accent2"], "ok": THEME["success"], "fail": THEME["fail"], "warn": THEME["warn"]}
        self.log_area.config(state=tk.NORMAL)
        self.log_area.insert(tk.END, msg + "\n")
        self.log_area.see(tk.END)
        self.log_area.config(state=tk.DISABLED)

    def clear_log(self):
        self.log_area.config(state=tk.NORMAL)
        self.log_area.delete("1.0", tk.END)
        self.log_area.config(state=tk.DISABLED)
        self.status_var.set("Cleared")


if __name__ == "__main__":
    app = ToolTester()
    app.mainloop()