# -*- coding: utf-8 -*-
"""
Tool Search 测试工具 v3.0
- 从 config.json 读取配置
- 支持从 API 拉取模型列表
- 用户自行选择测试哪些模型

配置文件: config.json
打包命令: pyinstaller --onefile --windowed tool_search_tester.py
"""

import tkinter as tk
from tkinter import scrolledtext, messagebox, ttk
import urllib.request
import urllib.error
import json
import threading
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")

class ToolSearchTester:
    def __init__(self):
        self.window = tk.Tk()
        self.window.title("Tool Search 测试工具 v3.0")
        self.window.geometry("1000x800")
        self.window.minsize(900, 700)
        
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
        self.base_url = tk.StringVar(value="")
        self.api_key = tk.StringVar(value="")
        self.models = []  # 从 API 拉取的模型列表
        self.selected_models = []  # 用户选择的模型
        
        self.setup_ui()
        self.load_config()
        
    def setup_ui(self):
        # 标题
        title_frame = tk.Frame(self.window, bg=self.colors["accent"], height=60)
        title_frame.pack(fill=tk.X)
        title_frame.pack_propagate(False)
        tk.Label(title_frame, text="Tool Search 模型支持度测试工具", 
                bg=self.colors["accent"], fg="white",
                font=("Segoe UI", 18, "bold")).pack(pady=15)
        
        # 主容器
        main = tk.Frame(self.window, bg=self.colors["bg"])
        main.pack(fill=tk.BOTH, expand=True, padx=20, pady=15)
        
        # === API 配置 ===
        api_frame = tk.LabelFrame(main, text="API 配置", bg=self.colors["bg"], fg=self.colors["info"],
                                  font=("Segoe UI", 11, "bold"), padx=15, pady=10)
        api_frame.pack(fill=tk.X, pady=(0, 12))
        
        tk.Label(api_frame, text="Base URL:", bg=self.colors["bg"], fg=self.colors["text"]).grid(row=0, column=0, sticky=tk.W, padx=8, pady=5)
        self.url_entry = tk.Entry(api_frame, textvariable=self.base_url, bg=self.colors["surface"], fg=self.colors["text"],
                                insertbackground=self.colors["text"], width=55)
        self.url_entry.grid(row=0, column=1, sticky=tk.W+tk.E, padx=8, pady=5)
        
        tk.Label(api_frame, text="API Key:", bg=self.colors["bg"], fg=self.colors["text"]).grid(row=1, column=0, sticky=tk.W, padx=8, pady=5)
        self.key_entry = tk.Entry(api_frame, textvariable=self.api_key, bg=self.colors["surface"], fg=self.colors["text"],
                                insertbackground=self.colors["text"], width=55, show="*")
        self.key_entry.grid(row=1, column=1, sticky=tk.W+tk.E, padx=8, pady=5)
        
        # === 模型列表 ===
        model_frame = tk.LabelFrame(main, text="选择要测试的模型 (从 API 拉取)", bg=self.colors["bg"], fg=self.colors["info"],
                                    font=("Segoe UI", 11, "bold"), padx=15, pady=10)
        model_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 12))
        
        # 拉取按钮
        btn_row = tk.Frame(model_frame, bg=self.colors["bg"])
        btn_row.pack(fill=tk.X, pady=(0, 10))
        
        self.fetch_btn = tk.Button(btn_row, text="[ 拉取模型列表 ]", command=self.fetch_models,
                                 bg=self.colors["accent"], fg="white", font=("Segoe UI", 10, "bold"),
                                 cursor="hand2", relief=tk.FLAT, padx=15, pady=5)
        self.fetch_btn.pack(side=tk.LEFT, padx=5)
        
        tk.Label(btn_row, text="(拉取费用由 API Key 所属账户承担，请谨慎操作)", 
                bg=self.colors["bg"], fg=self.colors["warning"], font=("Segoe UI", 9)).pack(side=tk.LEFT, padx=10)
        
        # 模型选择区域
        self.model_listbox = tk.Listbox(model_frame, selectmode=tk.EXTENDED, 
                                        bg=self.colors["surface"], fg=self.colors["text"],
                                        font=("Consolas", 11), height=10,
                                        selectbackground=self.colors["accent"],
                                        selectforeground="white",
                                        relief=tk.FLAT)
        self.model_listbox.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.model_scroll = tk.Scrollbar(self.model_listbox, orient=tk.VERTICAL)
        self.model_scroll.config(command=self.model_listbox.yview)
        self.model_listbox.config(yscrollcommand=self.model_scroll.set)
        
        tk.Label(model_frame, text="按住 Ctrl/Shift 多选，或 Ctrl+A 全选", 
                bg=self.colors["bg"], fg="#666", font=("Segoe UI", 8)).pack()
        
        # === 测试配置 ===
        config_frame = tk.LabelFrame(main, text="提示词", bg=self.colors["bg"], fg=self.colors["info"],
                                    font=("Segoe UI", 11, "bold"), padx=15, pady=10)
        config_frame.pack(fill=tk.X, pady=(0, 12))
        
        self.prompt_var = tk.StringVar(value="你有哪些工具可用？请调用 tool_search 工具来搜索。")
        prompt_entry = tk.Entry(config_frame, textvariable=self.prompt_var, bg=self.colors["surface"], 
                               fg=self.colors["text"], insertbackground=self.colors["text"], width=80)
        prompt_entry.pack(fill=tk.X, padx=8, pady=5)
        
        # === 按钮 ===
        btn_frame = tk.Frame(main, bg=self.colors["bg"])
        btn_frame.pack(fill=tk.X, pady=(0, 12))
        
        btn_style = {"font": ("Segoe UI", 11, "bold"), "cursor": "hand2", 
                    "relief": tk.FLAT, "borderwidth": 0}
        
        self.test_btn = tk.Button(btn_frame, text="[ 测试选中模型 ]", command=self.run_test,
                                bg=self.colors["info"], fg="white", width=18, height=2, **btn_style)
        self.test_btn.pack(side=tk.LEFT, padx=5)
        
        self.test_all_btn = tk.Button(btn_frame, text="[ 测试全部 ]", command=self.run_test_all,
                                     bg=self.colors["warning"], fg=self.colors["bg"], width=14, height=2, **btn_style)
        self.test_all_btn.pack(side=tk.LEFT, padx=5)
        
        tk.Button(btn_frame, text="[ 取消选择 ]", command=self.deselect_all,
                 bg=self.colors["surface"], fg=self.colors["text"], width=12, height=2, **btn_style).pack(side=tk.LEFT, padx=5)
        
        tk.Button(btn_frame, text="[ 清空结果 ]", command=self.clear_output,
                 bg="#555", fg="white", width=10, height=2, **btn_style).pack(side=tk.LEFT, padx=5)
        
        # === 结果显示 ===
        result_frame = tk.LabelFrame(main, text="测试结果", bg=self.colors["bg"], fg=self.colors["info"],
                                    font=("Segoe UI", 11, "bold"), padx=10, pady=5)
        result_frame.pack(fill=tk.BOTH, expand=True)
        
        self.result_text = scrolledtext.ScrolledText(result_frame, width=100, height=15,
                                                     bg=self.colors["surface"], fg=self.colors["text"],
                                                     font=("Consolas", 10), wrap=tk.WORD,
                                                     insertbackground=self.colors["text"],
                                                     relief=tk.FLAT, padx=10, pady=10)
        self.result_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        self.result_text.tag_config("success", foreground=self.colors["success"])
        self.result_text.tag_config("fail", foreground=self.colors["fail"])
        self.result_text.tag_config("info", foreground=self.colors["info"])
        self.result_text.tag_config("header", foreground=self.colors["accent"], font=("Consolas", 11, "bold"))
        
        # 状态栏
        status_frame = tk.Frame(main, bg=self.colors["surface"], height=28)
        status_frame.pack(fill=tk.X, pady=(10, 0))
        status_frame.pack_propagate(False)
        
        self.status_var = tk.StringVar(value="配置已加载 | 请先拉取模型列表")
        self.status_label = tk.Label(status_frame, textvariable=self.status_var, 
                                    bg=self.colors["surface"], fg=self.colors["text"],
                                    font=("Segoe UI", 9), anchor=tk.W)
        self.status_label.pack(side=tk.LEFT, padx=10)
        
        tk.Label(status_frame, text="v3.0", bg=self.colors["surface"], fg=self.colors["accent"],
                font=("Segoe UI", 8)).pack(side=tk.RIGHT, padx=10)
        
    def load_config(self):
        """从配置文件加载"""
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    config = json.load(f)
                
                self.base_url.set(config.get("api", {}).get("base_url", ""))
                self.api_key.set(config.get("api", {}).get("api_key", ""))
                
                saved_models = config.get("models", [])
                if saved_models:
                    self.update_model_list(saved_models)
                    self.status_var.set(f"配置已加载 | {len(saved_models)} 个模型")
            else:
                self.status_var.set("未找到 config.json，请手动输入配置")
        except Exception as e:
            self.status_var.set(f"加载配置失败: {e}")
            
    def save_config(self):
        """保存配置到文件"""
        try:
            config = {
                "api": {
                    "base_url": self.base_url.get(),
                    "api_key": self.api_key.get()
                },
                "models": self.models
            }
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=4, ensure_ascii=False)
        except Exception as e:
            self.log(f"保存配置失败: {e}", "fail")
            
    def fetch_models(self):
        """从 API 拉取模型列表"""
        base_url = self.base_url.get().strip()
        api_key = self.api_key.get().strip()
        
        if not api_key:
            messagebox.showwarning("提示", "请先输入 API Key")
            return
            
        if not base_url:
            messagebox.showwarning("提示", "请先输入 Base URL")
            return
            
        self.fetch_btn.config(state=tk.DISABLED, text="拉取中...")
        self.status_var.set("正在拉取模型列表...")
        
        def fetch():
            try:
                req = urllib.request.Request(
                    f"{base_url.rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {api_key}"}
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    result = json.loads(resp.read().decode())
                
                models = [m.get("id") for m in result.get("data", []) if m.get("id")]
                
                # 更新 UI
                self.window.after(0, lambda: self.update_model_list(models))
                self.window.after(0, lambda: self.save_config())
                self.window.after(0, lambda: self.status_var.set(f"已拉取 {len(models)} 个模型 | 选择要测试的模型"))
                
            except Exception as e:
                error_msg = str(e)
                self.window.after(0, lambda: self.status_var.set(f"拉取失败: {error_msg[:50]}"))
                self.window.after(0, lambda: self.fetch_btn.config(state=tk.NORMAL, text="[ 拉取模型列表 ]"))
                
        threading.Thread(target=fetch, daemon=True).start()
        
    def update_model_list(self, models):
        """更新模型列表"""
        self.models = models
        self.model_listbox.delete(0, tk.END)
        
        for model in models:
            self.model_listbox.insert(tk.END, model)
            
        self.fetch_btn.config(state=tk.NORMAL, text="[ 拉取模型列表 ]")
        self.status_var.set(f"已加载 {len(models)} 个模型 | 选择要测试的模型")
        
    def deselect_all(self):
        """取消选择"""
        self.model_listbox.selection_clear(0, tk.END)
        self.status_var.set("已取消选择")
        
    def get_selected_models(self):
        """获取选中的模型"""
        selection = self.model_listbox.curselection()
        if not selection:
            return []
        return [self.models[i] for i in selection]
        
    def log(self, msg, tag="info"):
        self.result_text.insert(tk.END, msg + "\n", tag)
        self.result_text.see(tk.END)
        self.window.update_idletasks()
        
    def clear_output(self):
        self.result_text.delete(1.0, tk.END)
        self.status_var.set("结果已清空")
        
    def set_buttons_state(self, enabled):
        state = tk.NORMAL if enabled else tk.DISABLED
        self.test_btn.config(state=state)
        self.test_all_btn.config(state=state)
        
    def test_single_model(self, model_name, prompt_text):
        """测试单个模型"""
        base_url = self.base_url.get().strip()
        api_key = self.api_key.get().strip()
        
        url = f"{base_url}/chat/completions"
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
                                               "Authorization": f"Bearer {api_key}"},
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
            return False, f"No tool_search call"
            
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read().decode())
                return False, f"HTTP {e.code}: {err.get('error',{}).get('message', e.reason)}"
            except:
                return False, f"HTTP {e.code}"
        except Exception as e:
            return False, str(e)
    
    def run_test(self):
        """测试选中的模型"""
        models = self.get_selected_models()
        if not models:
            messagebox.showwarning("提示", "请先选择要测试的模型")
            return
            
        if not self.api_key.get().strip():
            messagebox.showwarning("提示", "请输入 API Key")
            return
            
        self.run_tests(models)
        
    def run_test_all(self):
        """测试所有模型"""
        if not self.models:
            messagebox.showwarning("提示", "请先拉取模型列表")
            return
            
        if not self.api_key.get().strip():
            messagebox.showwarning("提示", "请输入 API Key")
            return
            
        self.run_tests(self.models)
        
    def run_tests(self, models):
        """执行测试"""
        prompt = self.prompt_var.get().strip() or "你有哪些工具可用？请调用 tool_search 工具。"
        
        self.set_buttons_state(False)
        self.status_var.set(f"测试中... ({len(models)} 个模型)")
        
        def test():
            self.log("=" * 60, "header")
            self.log(f"  Tool Search 支持度测试", "header")
            self.log(f"  模型数量: {len(models)}", "header")
            self.log(f"  提示词: {prompt[:50]}...", "header")
            self.log("-" * 60)
            
            ok_count, fail_count = 0, 0
            
            for model in models:
                self.log(f"\n  测试: {model}...")
                success, result = self.test_single_model(model, prompt)
                
                if success:
                    self.log(f"    [OK] 支持 tool_search", "success")
                    self.log(f"        参数: {result[:60]}...", "success")
                    ok_count += 1
                else:
                    self.log(f"    [FAIL] 不支持", "fail")
                    self.log(f"        {result[:70]}...", "fail")
                    fail_count += 1
                    
                self.window.update_idletasks()
            
            self.log("\n" + "=" * 60)
            self.log(f"  汇总: {ok_count}/{len(models)} 支持", "header")
            self.log("=" * 60)
            
            self.status_var.set(f"完成: {ok_count}/{len(models)} 支持")
            self.set_buttons_state(True)
            
        threading.Thread(target=test, daemon=True).start()

if __name__ == "__main__":
    ToolSearchTester().window.mainloop()
