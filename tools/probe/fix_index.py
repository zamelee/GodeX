src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src\index.html"
c = open(src, "r", encoding="utf-8").read()
old = """      try {
        const r = await invoke("probe_model", {
          baseUrl: baseUrl,
          apiKey: prov.api_key,
          model: model,
          claimedCtx: 100000,
          claimedMaxTokens: 131072
        });
        
        if (r.success) {
          if (r.context_window) log("  Context: " + r.context_window + " tokens");
          if (r.max_tokens) log("  MaxOut: " + r.max_tokens + " tokens");
          const caps2 = [];
          if (r.text) caps2.push("text");
          if (r.image) caps2.push("image");
          if (r.video) caps2.push("video");
          if (r.audio) caps2.push("audio");
          if (r.function) caps2.push("func");
          if (r.reasoning) caps2.push("reason:" + r.reasoning);
          if (caps2.length > 0) log("  Capabilities: " + caps2.join(", "));
          
          const m = enabled.find(em => em.provider === provName && em.model === model);
          if (m) {
            if (r.context_window && !m.context_window) m.context_window = r.context_window;
            if (r.max_tokens && !m.max_tokens) m.max_tokens = r.max_tokens;
          }
        } else {
          log("  FAILED: " + (r.error || "unknown error"));
        }
        
        _probeResults.push(r);
        _probeChanged = true;
        updateProbeResultsTable();
        
      } catch(e) {
        log("  ERROR: " + e);
        _probeResults.push({ model: model, success: false, error: String(e) });
        _probeChanged = true;
        updateProbeResultsTable();
      }"""
new = """      // Use the 3-split probe: ctx, max_tokens, caps
      // Each emits "probe-progress" events (handled in startProbeRun wrapper)
      const r = { model: model, success: true, error: null, context_window: null, max_tokens: null,
        text: null, image: null, video: null, audio: null, function: null, reasoning: null,
        web_search: null, file_search: null, computer_use: null, tool_search: null, mcp: null };
      try {
        r.context_window = await invoke("probe_ctx", {
          baseUrl: baseUrl, apiKey: prov.api_key, model: model, claimed: 100000
        });
        if (r.context_window) log("  Context: " + r.context_window + " tokens");

        r.max_tokens = await invoke("probe_max_tokens", {
          baseUrl: baseUrl, apiKey: prov.api_key, model: model, claimed: 131072
        });
        if (r.max_tokens) log("  MaxOut: " + r.max_tokens + " tokens");

        const caps = await invoke("probe_caps", {
          baseUrl: baseUrl, apiKey: prov.api_key, model: model
        });
        r.text = caps.text; r.image = caps.image; r.video = caps.video;
        r.audio = caps.audio; r.function = caps.function; r.reasoning = caps.reasoning;
        r.web_search = caps.web_search; r.file_search = caps.file_search;
        r.computer_use = caps.computer_use; r.tool_search = caps.tool_search; r.mcp = caps.mcp;
        const caps2 = [];
        if (r.text) caps2.push("text");
        if (r.image) caps2.push("image");
        if (r.video) caps2.push("video");
        if (r.audio) caps2.push("audio");
        if (r.function) caps2.push("func");
        if (r.reasoning) caps2.push("reason");
        if (caps2.length > 0) log("  Capabilities: " + caps2.join(", "));

        const m = enabled.find(em => em.provider === provName && em.model === model);
        if (m) {
          if (r.context_window && !m.context_window) m.context_window = r.context_window;
          if (r.max_tokens && !m.max_tokens) m.max_tokens = r.max_tokens;
        }
        _probeResults.push(r);
        _probeChanged = true;
        updateProbeResultsTable();
      } catch(e) {
        log("  ERROR: " + e);
        r.success = false;
        r.error = String(e);
        _probeResults.push(r);
        _probeChanged = true;
        updateProbeResultsTable();
      }"""
if old in c:
    c = c.replace(old, new, 1)
    open(src, "w", encoding="utf-8").write(c)
    print("Replaced probe_model block with 3-command version")
else:
    print("OLD NOT FOUND")
