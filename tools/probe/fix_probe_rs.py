content = open(r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\src\probe.rs", "r", encoding="utf-8").read()
old_ctx = """        self.emit(ProbeEvent::info(\"ctx\", \"start\", &format!(\"claimed={}\", claimed)));
        let url = self.url();
        let headers = self.headers();
        let body_for = |tokens: u64| -> serde_json::Value {
            let content_len = ((tokens as f64) * 0.75) as usize;
            let content = \"A\".repeat(content_len.max(100));
            serde_json::json!({
                \"model\": self.model,
                \"messages\": [{\"role\": \"user\", \"content\": content}],
                \"max_tokens\": 32,
            })
        };"""
new_ctx = """        self.emit(ProbeEvent::info(\"ctx\", \"start\", &format!(\"claimed={}\", claimed)));
        let url = self.url();
        let headers = self.headers();
        let model = self.model.clone();
        let build_body = |tokens: u64| -> serde_json::Value {
            let content_len = ((tokens as f64) * 0.75) as usize;
            let content = \"A\".repeat(content_len.max(100));
            serde_json::json!({
                \"model\": model,
                \"messages\": [{\"role\": \"user\", \"content\": content}],
                \"max_tokens\": 32,
            })
        };"""
if old_ctx in content:
    content = content.replace(old_ctx, new_ctx, 1)
    content = content.replace("body_for(test)", "build_body(test)", 1)
    content = content.replace("body_for(mid)", "build_body(mid)", 1)
    print("Fixed probe_ctx")
else:
    print("probe_ctx: NOT FOUND")
old_mt = """        self.emit(ProbeEvent::info(\"max_tokens\", \"start\", &format!(\"claimed={}\", claimed)));
        let url = self.url();
        let headers = self.headers();
        let body_for = |mt: u64| -> serde_json::Value {
            serde_json::json!({
                \"model\": self.model,
                \"messages\": [{\"role\": \"user\", \"content\": \"OK\"}],
                \"max_tokens\": mt,
            })
        };"""
new_mt = """        self.emit(ProbeEvent::info(\"max_tokens\", \"start\", &format!(\"claimed={}\", claimed)));
        let url = self.url();
        let headers = self.headers();
        let model = self.model.clone();
        let build_body = |mt: u64| -> serde_json::Value {
            serde_json::json!({
                \"model\": model,
                \"messages\": [{\"role\": \"user\", \"content\": \"OK\"}],
                \"max_tokens\": mt,
            })
        };"""
if old_mt in content:
    content = content.replace(old_mt, new_mt, 1)
    content = content.replace("body_for(test)", "build_body(test)", 1)
    content = content.replace("body_for(mid)", "build_body(mid)", 1)
    print("Fixed probe_max_tokens")
else:
    print("probe_max_tokens: NOT FOUND")
open(r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\src\probe.rs", "w", encoding="utf-8").write(content)
print("done")
