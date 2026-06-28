# detector.py - Model capability detection using Chat Completions API
import requests
import time
from typing import Dict, List, Optional, Callable, Any
from dataclasses import dataclass

@dataclass
class ProbeResult:
    capability: str
    success: bool
    value: Any = None
    error: Optional[str] = None

class ModelDetector:
    def __init__(self, base_url: str, api_key: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._running = False
        self._stopped = False
    
    def stop(self):
        self._stopped = True
    
    @property
    def is_running(self) -> bool:
        return self._running
    
    def _make_request(self, model: str, payload: Dict) -> Dict:
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        response = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
        return response
    
    def _log(self, message: str, callback: Optional[Callable] = None):
        timestamp = time.strftime("%H:%M:%S")
        log_line = f"[{timestamp}] {message}"
        print(log_line)
        if callback:
            callback(log_line)
    
    def probe_context_window(self, model: str, claimed: int, log_callback: Optional[Callable] = None) -> ProbeResult:
        self._log(f"[ctx] {model}: claimed={claimed}", log_callback)
        
        if self._stopped:
            return ProbeResult("context_window", False, error="Stopped")
        
        high = int(claimed * 1.25)
        low = int(claimed * 0.5)
        
        if self._test_context(model, claimed, log_callback):
            self._log(f"  {claimed} OK (claimed)", log_callback)
            while high < claimed * 2:
                if self._stopped:
                    return ProbeResult("context_window", False, error="Stopped")
                mid = (claimed + high) // 2
                if self._test_context(model, mid, log_callback):
                    self._log(f"  {mid} OK", log_callback)
                    claimed = mid
                    high = int(high * 1.25)
                else:
                    self._log(f"  {mid} FAIL", log_callback)
                    break
            return ProbeResult("context_window", True, value=claimed)
        
        while low < high:
            if self._stopped:
                return ProbeResult("context_window", False, error="Stopped")
            
            mid = (low + high) // 2
            if self._test_context(model, mid, log_callback):
                self._log(f"  {mid} OK", log_callback)
                low = mid + 1
            else:
                self._log(f"  {mid} FAIL", log_callback)
                high = mid
        
        result = low - 1
        return ProbeResult("context_window", True, value=result)
    
    def _test_context(self, model: str, tokens: int, log_callback: Optional[Callable] = None) -> bool:
        if self._stopped:
            return False
        
        text_tokens = int(tokens * 0.9)
        output_tokens = min(int(tokens * 0.1), 1000)
        
        chunk = "你好，这是一个测试消息。请回复 OK。"
        repeat_count = max(1, text_tokens // 40)
        messages = [{"role": "user", "content": chunk * repeat_count}]
        
        payload = {"model": model, "messages": messages, "max_tokens": output_tokens}
        
        try:
            response = self._make_request(model, payload)
            if response.status_code == 200:
                return True
            elif response.status_code == 400:
                return False
            else:
                return False
        except:
            return False
    
    def probe_max_output(self, model: str, log_callback: Optional[Callable] = None) -> ProbeResult:
        self._log(f"[max_output] probing directly...", log_callback)
        
        if self._stopped:
            return ProbeResult("max_output", False, error="Stopped")
        
        low = 1000
        high = 200000
        
        while low < high:
            if self._stopped:
                return ProbeResult("max_output", False, error="Stopped")
            
            mid = (low + high + 1) // 2
            
            if self._test_max_output(model, mid, log_callback):
                self._log(f"  {mid} OK", log_callback)
                low = mid
            else:
                self._log(f"  {mid} FAIL", log_callback)
                high = mid - 1
        
        return ProbeResult("max_output", True, value=low)
    
    def _test_max_output(self, model: str, max_tokens: int, log_callback: Optional[Callable] = None) -> bool:
        if self._stopped:
            return False
        
        messages = [{"role": "user", "content": "回复 OK"}]
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens}
        
        try:
            response = self._make_request(model, payload)
            if response.status_code == 200:
                return True
            return False
        except:
            return False
    
    def probe_text(self, model: str, log_callback: Optional[Callable] = None) -> ProbeResult:
        self._log(f"[text] testing...", log_callback)
        
        if self._stopped:
            return ProbeResult("text", False, error="Stopped")
        
        messages = [{"role": "user", "content": "请回复 OK"}]
        payload = {"model": model, "messages": messages, "max_tokens": 10}
        
        try:
            response = self._make_request(model, payload)
            if response.status_code == 200:
                self._log(f"  OK", log_callback)
                return ProbeResult("text", True, value=True)
            else:
                self._log(f"  FAIL (status={response.status_code})", log_callback)
                return ProbeResult("text", False, error=f"status={response.status_code}")
        except Exception as e:
            self._log(f"  FAIL ({str(e)[:30]})", log_callback)
            return ProbeResult("text", False, error=str(e))
    
    def probe_image(self, model: str, log_callback: Optional[Callable] = None) -> ProbeResult:
        self._log(f"[image] testing...", log_callback)
        
        if self._stopped:
            return ProbeResult("image", False, error="Stopped")
        
        tiny_png_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "描述这张图片"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{tiny_png_base64}"}}
                ]
            }
        ]
        
        payload = {"model": model, "messages": messages, "max_tokens": 50}
        
        try:
            response = self._make_request(model, payload)
            if response.status_code == 200:
                self._log(f"  OK", log_callback)
                return ProbeResult("image", True, value=True)
            elif response.status_code == 400:
                self._log(f"  NOT SUPPORTED", log_callback)
                return ProbeResult("image", True, value=False)
            else:
                self._log(f"  FAIL (status={response.status_code})", log_callback)
                return ProbeResult("image", False, error=f"status={response.status_code}")
        except Exception as e:
            self._log(f"  FAIL ({str(e)[:30]})", log_callback)
            return ProbeResult("image", False, error=str(e))
    
    def probe_function_call(self, model: str, log_callback: Optional[Callable] = None) -> ProbeResult:
        self._log(f"[function] testing...", log_callback)
        
        if self._stopped:
            return ProbeResult("function", False, error="Stopped")
        
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get current weather",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {"type": "string", "description": "City name"}
                        },
                        "required": ["location"]
                    }
                }
            }
        ]
        
        messages = [{"role": "user", "content": "北京天气怎么样？"}]
        payload = {"model": model, "messages": messages, "tools": tools, "tool_choice": "auto"}
        
        try:
            response = self._make_request(model, payload)
            if response.status_code == 200:
                data = response.json()
                choices = data.get("choices", [])
                if choices:
                    message = choices[0].get("message", {})
                    if "tool_calls" in message:
                        self._log(f"  OK (tool_calls)", log_callback)
                        return ProbeResult("function", True, value=True)
                self._log(f"  NO TOOL CALL", log_callback)
                return ProbeResult("function", True, value=False)
            elif response.status_code == 400:
                self._log(f"  NOT SUPPORTED", log_callback)
                return ProbeResult("function", True, value=False)
            else:
                self._log(f"  FAIL (status={response.status_code})", log_callback)
                return ProbeResult("function", False, error=f"status={response.status_code}")
        except Exception as e:
            self._log(f"  FAIL ({str(e)[:30]})", log_callback)
            return ProbeResult("function", False, error=str(e))
    
    def probe_reasoning(self, model: str, log_callback: Optional[Callable] = None) -> ProbeResult:
        self._log(f"[reasoning] testing...", log_callback)
        
        if self._stopped:
            return ProbeResult("reasoning", False, error="Stopped")
        
        messages = [{"role": "user", "content": "1+1等于几？"}]
        payload = {"model": model, "messages": messages, "max_tokens": 100, "reasoning_effort": "low"}
        
        try:
            response = self._make_request(model, payload)
            if response.status_code == 200:
                self._log(f"  OK", log_callback)
                return ProbeResult("reasoning", True, value=True)
            elif response.status_code == 400:
                self._log(f"  NOT SUPPORTED", log_callback)
                return ProbeResult("reasoning", True, value=False)
            else:
                self._log(f"  FAIL (status={response.status_code})", log_callback)
                return ProbeResult("reasoning", False, error=f"status={response.status_code}")
        except Exception as e:
            self._log(f"  FAIL ({str(e)[:30]})", log_callback)
            return ProbeResult("reasoning", False, error=str(e))
    
    def probe_model(self, model: str, claimed_context: int, capabilities: List[str], log_callback: Optional[Callable] = None) -> Dict[str, ProbeResult]:
        self._stopped = False
        self._running = True
        results = {}
        
        self._log(f"Probing {model}...", log_callback)
        
        for cap in capabilities:
            if self._stopped:
                break
            
            if cap == "context_window":
                results[cap] = self.probe_context_window(model, claimed_context, log_callback)
            elif cap == "max_tokens":
                results[cap] = self.probe_max_output(model, log_callback)
            elif cap == "text":
                results[cap] = self.probe_text(model, log_callback)
            elif cap == "image":
                results[cap] = self.probe_image(model, log_callback)
            elif cap == "function":
                results[cap] = self.probe_function_call(model, log_callback)
            elif cap == "reasoning":
                results[cap] = self.probe_reasoning(model, log_callback)
            else:
                self._log(f"[{cap}] not implemented", log_callback)
                results[cap] = ProbeResult(cap, False, error="not implemented")
        
        self._running = False
        return results
