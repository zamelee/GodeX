# -*- coding: utf-8 -*-
"""
Tool Search 测试工具 v2.0
用于测试各模型是否会调用 tool_search

打包命令:
  pip install pyinstaller
  pyinstaller --onefile --windowed --icon=app.ico tool_search_tester.py

或使用 Nuitka (更小):
  pip install nuitka
  nuitka --onefile --windowed tool_search_tester.py
"""

import tkinter as tk
from tkinter import scrolledtext, messagebox, ttk, font as tkfont
import urllib.request
import urllib.error
import json
import threading
import os

class ToolSearchTester:
    def __init__(self):
        self.window = tk.Tk()
        self.window.title("Tool Search 测试工具 v2.0")
        self.window.geometry("950x750")
        self.window.minsize(800, 600)
        
        # 颜色主题
        self.colors = {
            "bg": "#1e1e2e",
            "surface": "#2d2d44",
            "text": "#cdd6f4",
            "success": "#a6e3a1",
            "fail": "#f38ba8",
            "info": "#89b4fa",
            "warning": "#f9e2af",
            "accent": "#cba6f7"
        }
        
        self.window.configure(bg=self.colors["bg"])
        
        # 配置
        self.api_key = tk.StringVar(value="")
        self.base_url = tk.StringVar(value="https://minnimax.chat/v1")
        self.model = tk.StringVar(value="MiniMax-M3")
        self.prompt = tk.StringVar(value="你有哪些工具可用？请调用 tool_search 工具来搜索。")
        
        self.setup_styles()
        self.setup_ui()
        
    def setup_styles(self):
        self.default_font = tkfont.nametofont("TkDefaultFont")
        self.default_font.configure(family="Segoe UI", size=10)
        
    def create_label(self, parent, text, row, col, **kwargs):
        lbl = tk.Label(parent, text=text, bg=self.colors["bg"], fg=self.colors["text"], **kwargs)
        lbl.grid(row=row, column=col, sticky=tk.W, padx=8, pady=4)
        return lbl
        
    def create_entry(self, parent, var, row, col, colspan=2, **kwargs):
        entry = tk.Entry(parent, textvariable=var, bg=self.colors["surface"], fg=self.colors["text"],
                        insertbackground=self.colors["text"], **kwargs)
        entry.grid(row=row, column=col, columnspan=colspan, sticky=tk.W+tk.E, padx=8, pady=4)
        return entry
        
    def setup_ui(self):
        # 标题
        title_frame = tk.Frame(self.window, bg=self.colors["accent"], height=50)
        title_frame.pack(fill=tk.X)
        title_frame.pack_propagate(False)
        
        title = tk.Label(title_frame, text="Tool Search 模型支持度测试工具", 
                        bg=self.colors["accent"], fg="white",
                        font=("Segoe UI", 16, "bold"))
        title.pack(pady=12)
        
        # 主容器
        main = tk.Frame(self.window, bg=self.colors["bg"])
        main.pack(fill=tk.BOTH, expand=True, padx=20, pady=15)
        
        # === API 配置 ===
        api_frame = tk.LabelFrame(main, text="API 配置", bg=self.colors["bg"], fg=self.colors["info"],
                                  font=("Segoe UI", 11, "bold"), padx=15, pady=10)
        api_frame.pack(fill=tk.X, pady=(0, 12))
        
        self.create_label(api_frame, "Base URL:", 0, 0)
        url_entry = self.create_entry(api_frame, self.base_url, 0, 1, colspan=2)
        url_entry.configure(width=60)
        
        self.create_label(api_frame, "API Key:", 1, 0)
        key_entry = self.create_entry(api_frame, self.api_key, 1, 1, colspan=2)
        key_entry.configure(width=60, show="*")
        
        # === 测试配置 ===
        config_frame = tk.LabelFrame(main, text="测试配置", bg=self.colors["bg"], fg=self.colors["info"],
                                    font=("Segoe UI", 11, "bold"), padx=15, pady=10)
        config_frame.pack(fill=tk.X, pady=(0, 12))
        
        self.create_label(config_frame, "模型:", 0, 0)
        model_combo = ttk.Combobox(config_frame, textvariable=self.model,
                                  values=["MiniMax-M3", "MiniMax-M2.7-highspeed", "MiniMax-M2.7"],
                                  width=35, state="readonly", font=("Segoe UI", 10))
        model_combo.grid(row=0, column=1, sticky=tk.W, padx=8, pady=4)
        
        self.create_label(config_frame, "提示词:", 1, 0)
        prompt_entry = self.create_entry(config_frame, self.prompt, 1, 1, colspan=2)
        prompt_entry.configure(width=60)
        
        # === 按钮 ===
        btn_frame = tk.Frame(main, bg=self.colors["bg"])
        btn_frame.pack(fill=tk.X, pady=(0, 12))
        
        btn_style = {
            "font": ("Segoe UI", 11, "bold"),
            "cursor": "hand2",
            "width": 14,
            "height": 2,
            "relief": tk.FLAT,
            "borderwidth": 0
        }
        
        self.test_btn = tk.Button(btn_frame, text="[  测试  ]", command=self.run_test,
                                 bg=self.colors["info"], fg="white", **btn_style)
        self.test_btn.pack(side=tk.LEFT, padx=6)
        
        self.test_all_btn = tk.Button(btn_frame, text="[ 测试全部 ]", command=self.run_test_all,
                                     bg=self.colors["warning"], fg=self.colors["bg"], **btn_style)
        self.test_all_btn.pack(side=tk.LEFT, padx=6)
        
        clear_btn = tk.Button(btn_frame, text="[  清空  ]", command=self.clear_output,
                            bg=self.colors["surface"], fg=self.colors["text"], **btn_style)
        clear_btn.pack(side=tk.LEFT, padx=6)
        
        # === 结果显示 ===
        result_frame = tk.LabelFrame(main, text="测试结果", bg=self.colors["bg"], fg=self.colors["info"],
                                    font=("Segoe UI", 11, "bold"), padx=10, pady=5)
        result_frame.pack(fill=tk.BOTH, expand=True)
        
        self.result_text = scrolledtext.ScrolledText(result_frame, width=90, height=20,
                                                     bg=self.colors["surface"], fg=self.colors["text"],
                                                     font=("Consolas", 10), wrap=tk.WORD,
                                                     insertbackground=self.colors["text"],
                                                     relief=tk.FLAT, padx=10, pady=10)
        self.result_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 配置 tag 用于彩色显示
        self.result_text.tag_config("success", foreground=self.colors["success"])
        self.result_text.tag_config("fail", foreground=self.colors["fail"])
        self.result_text.tag_config("info", foreground=self.colors["info"])
        self.result_text.tag_config("header", foreground=self.colors["accent"], font=("Consolas", 11, "bold"))
        
        # === 状态栏 ===
        status_frame = tk.Frame(main, bg=self.colors["surface"], height=30)
        status_frame.pack(fill=tk.X, pady=(10, 0))
        status_frame.pack_propagate(False)
        
        self.status_var = tk.StringVar(value="就绪 | 输入 API Key 开始测试")
        self.status_label = tk.Label(status_frame, textvariable=self.status_var, 
                                    bg=self.colors["surface"], fg=self.colors["text"],
                                    font=("Segoe UI", 9), anchor=tk.W)
        self.status_label.pack(side=tk.LEFT, padx=10)
        
        version_label = tk.Label(status_frame, text="v2.0", 
                               bg=self.colors["surface"], fg=self.colors["accent"],
                               font=("Segoe UI", 8))
        version_label.pack(side=tk.RIGHT, padx=10)
        
    def log(self, msg, tag=None):
        self.result_text.insert(tk.END, msg + "\n", tag or "info")
        self.result_text.see(tk.END)
        self.window.update_idletasks()
        
    def clear_output(self):
        self.result_text.delete(1.0, tk.END)
        self.status_var.set("就绪")
        
    def set_buttons_state(self, enabled):
        state = tk.NORMAL if enabled else tk.DISABLED
        self.test_btn.config(state=state)
        self.test_all_btn.config(state=state)
        
    def test_single_model(self, model_name, prompt_text):
        url = f"{self.base_url.get()}/chat/completions"
        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": prompt_text}],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "tool_search",
                    "description": "搜索可用的 MCP 工具",
                    "parameters": {
                        "type": "object",
                        "properties": {"query": {"type": "string", "description": "搜索查询"}},
                        "required": ["query"]
                    }
                }
            }],
            "max_tokens": 1024
        }
        
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                        headers={"Content-Type": "application/json", 
                                                 "Authorization": f"Bearer {self.api_key.get()}"},
                                        method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode())
            
            if "error" in result:
                return False, result["error"].get("message", "Unknown")
            
            tool_calls = result.get("choices", [{}])[0].get("message", {}).get("tool_calls", [])
            tool_search = [tc for tc in tool_calls if tc.get("function", {}).get("name") == "tool_search"]
            
            if tool_search:
                args = tool_search[0].get("function", {}).get("arguments", "{}")
                return True, args
            return False, f"No tool_search call. Got: {[tc.get('function',{}).get('name') for tc in tool_calls]}"
            
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read().decode())
                return False, f"HTTP {e.code}: {err.get('error',{}).get('message', e.reason)}"
            except:
                return False, f"HTTP {e.code}"
        except Exception as e:
            return False, str(e)
    
    def run_test(self):
        if not self.api_key.get().strip():
            messagebox.showwarning("提示", "请输入 API Key")
            return
        self.set_buttons_state(False)
        self.status_var.set("测试中...")
        
        def test():
            self.log("=" * 55, "header")
            self.log(f"  Model: {self.model.get()}", "header")
            self.log(f"  Prompt: {self.prompt.get()[:40]}...", "header")
            self.log("-" * 55)
            
            success, result = self.test_single_model(self.model.get(), self.prompt.get())
            
            if success:
                self.log("  [OK] Model called tool_search!", "success")
                self.log(f"      Arguments: {result[:80]}", "success")
                self.status_var.set(f"OK - {self.model.get()}")
            else:
                self.log("  [FAIL] Model did NOT call tool_search", "fail")
                self.log(f"      Reason: {result[:60]}", "fail")
                self.status_var.set(f"FAIL - {self.model.get()}")
            self.log("")
            self.set_buttons_state(True)
            
        threading.Thread(target=test, daemon=True).start()
        
    def run_test_all(self):
        if not self.api_key.get().strip():
            messagebox.showwarning("提示", "请输入 API Key")
            return
        self.set_buttons_state(False)
        self.status_var.set("测试中...")
        
        def test():
            models = ["MiniMax-M3", "MiniMax-M2.7-highspeed", "MiniMax-M2.7"]
            
            self.log("=" * 55, "header")
            self.log("  All Models Test", "header")
            self.log(f"  Prompt: {self.prompt.get()[:50]}...", "header")
            self.log("-" * 55)
            
            ok_count, fail_count = 0, 0
            results = {}
            
            for m in models:
                success, result = self.test_single_model(m, self.prompt.get())
                results[m] = success
                
                if success:
                    self.log(f"  [OK] {m}", "success")
                    ok_count += 1
                else:
                    self.log(f"  [FAIL] {m}: {result[:50]}", "fail")
                    fail_count += 1
            
            self.log("-" * 55)
            self.log(f"  Summary: {ok_count}/{len(models)} supported", "header")
            self.log("=" * 55)
            
            self.status_var.set(f"完成: {ok_count}/{len(models)} 支持")
            self.set_buttons_state(True)
            
        threading.Thread(target=test, daemon=True).start()

if __name__ == "__main__":
    ToolSearchTester().window.mainloop()
