/* Complete config.rs patch - production code + tests, 5+3 edits */
const fs = require("fs");
const path = "studio-tauri/src-tauri/src/config.rs";
let s = fs.readFileSync(path, "utf8");
const LF = "\n";
const findReplace = (find, repl) => {
  if (!s.includes(find)) { console.error("NOT FOUND:\n" + find.slice(0, 200)); process.exit(1); }
  s = s.replace(find, repl);
};

/* === Edit 1: EnabledModel struct === */
findReplace(
  "    /// Safety margin ratio (0.0-1.0). Default 0.95 (95%)." + LF +
  "    /// Applied to context_window and max_tokens when computing effective limits." + LF +
  "    #[serde(skip_serializing_if = \"Option::is_none\", default)]" + LF +
  "    pub margin: Option<f64>," + LF + "}",
  "    /// Safety margin ratio (0.0-1.0). Default 0.95 (95%)." + LF +
  "    /// Applied to context_window and max_tokens when computing effective limits." + LF +
  "    #[serde(skip_serializing_if = \"Option::is_none\", default)]" + LF +
  "    pub margin: Option<f64>," + LF +
  "    /// Reasoning effort: \"none\" | \"enabled\" | \"max\". None = no reasoning field emitted." + LF +
  "    #[serde(skip_serializing_if = \"Option::is_none\", default)]" + LF +
  "    pub reasoning: Option<String>," + LF +
  "    /// Raw context_window value measured by model-probe, before margin multiplication." + LF +
  "    /// Read from the # probe_raw: yaml comment line; never re-emitted by the user" + LF +
  "    /// (model-probe is the sole writer). Preserved across save round-trips." + LF +
  "    #[serde(skip_serializing_if = \"Option::is_none\", default)]" + LF +
  "    pub probe_raw: Option<u64>," + LF +
  "    /// ISO-8601 UTC timestamp of the most recent successful probe." + LF +
  "    /// Read from the # probed_at: yaml comment line; same persistence rules as probe_raw." + LF +
  "    #[serde(skip_serializing_if = \"Option::is_none\", default)]" + LF +
  "    pub probed_at: Option<String>," + LF + "}"
);
console.log("Edit 1 done (struct)");

/* === Edit 2: read_enabled_models === */
findReplace(
  "            current = Some(EnabledModel {" + LF +
  "                provider: rest.trim().to_string()," + LF +
  "                model: String::new()," + LF +
  "                id: None," + LF +
  "                context_window: None," + LF +
  "                max_tokens: None," + LF +
  "                multimodal: None," + LF +
  "                capabilities: None," + LF +
  "                note: None," + LF +
  "                margin: None," + LF +
  "            });" + LF +
  "            continue;" + LF +
  "        }" + LF +
  "        if let Some(p) = current.as_mut() {" + LF +
  "            if let Some(rest) = trimmed.strip_prefix(\"model:\") {" + LF +
  "                p.model = rest.trim().to_string();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"id:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.id = Some(v.trim_matches('\"').to_string());" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"context_window:\") {" + LF +
  "                p.context_window = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"max_tokens:\") {" + LF +
  "                p.max_tokens = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"margin:\") {" + LF +
  "                p.margin = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"multimodal:\") {" + LF +
  "                p.multimodal = Some(rest.trim() == \"true\");" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"note:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.note = Some(v.trim_matches('\"').to_string());" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    if let Some(prev) = current.take() {" + LF +
  "        out.push(prev);" + LF +
  "    }" + LF +
  "    out" + LF +
  "}" + LF + LF +
  "pub fn read_discovered_models(path: &Path) -> Vec<EnabledModel> {",
  "            current = Some(EnabledModel {" + LF +
  "                provider: rest.trim().to_string()," + LF +
  "                model: String::new()," + LF +
  "                id: None," + LF +
  "                context_window: None," + LF +
  "                max_tokens: None," + LF +
  "                multimodal: None," + LF +
  "                capabilities: None," + LF +
  "                note: None," + LF +
  "                margin: None," + LF +
  "                reasoning: None," + LF +
  "                probe_raw: None," + LF +
  "                probed_at: None," + LF +
  "            });" + LF +
  "            continue;" + LF +
  "        }" + LF +
  "        if let Some(p) = current.as_mut() {" + LF +
  "            if let Some(rest) = trimmed.strip_prefix(\"model:\") {" + LF +
  "                p.model = rest.trim().to_string();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"id:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.id = Some(v.trim_matches('\"').to_string());" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"context_window:\") {" + LF +
  "                p.context_window = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"max_tokens:\") {" + LF +
  "                p.max_tokens = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"margin:\") {" + LF +
  "                p.margin = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"reasoning:\") {" + LF +
  "                let v = rest.trim().trim_matches('\"').to_string();" + LF +
  "                p.reasoning = if v.is_empty() { None } else { Some(v) };" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"multimodal:\") {" + LF +
  "                p.multimodal = Some(rest.trim() == \"true\");" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"note:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.note = Some(v.trim_matches('\"').to_string());" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"#\") {" + LF +
  "                let comment = rest.trim();" + LF +
  "                if let Some(v) = comment.strip_prefix(\"probe_raw:\") {" + LF +
  "                    p.probe_raw = v.trim().parse().ok();" + LF +
  "                } else if let Some(v) = comment.strip_prefix(\"probed_at:\") {" + LF +
  "                    p.probed_at = Some(v.trim().to_string());" + LF +
  "                }" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    if let Some(prev) = current.take() {" + LF +
  "        out.push(prev);" + LF +
  "    }" + LF +
  "    out" + LF +
  "}" + LF + LF +
  "pub fn read_discovered_models(path: &Path) -> Vec<EnabledModel> {"
);
console.log("Edit 2 done (read_enabled)");

/* === Edit 3: read_discovered_models === */
findReplace(
  "            current = Some(EnabledModel {" + LF +
  "                provider: rest.trim().to_string()," + LF +
  "                model: String::new()," + LF +
  "                id: None," + LF +
  "                context_window: None," + LF +
  "                max_tokens: None," + LF +
  "                multimodal: None," + LF +
  "                capabilities: None," + LF +
  "                note: None," + LF +
  "                margin: None," + LF +
  "            });" + LF +
  "            continue;" + LF +
  "        }" + LF +
  "        if let Some(p) = current.as_mut() {" + LF +
  "            if let Some(rest) = trimmed.strip_prefix(\"model:\") {" + LF +
  "                p.model = rest.trim().to_string();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"id:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.id = Some(v.trim_matches('\"').to_string());" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"context_window:\") {" + LF +
  "                p.context_window = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"max_tokens:\") {" + LF +
  "                p.max_tokens = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"margin:\") {" + LF +
  "                p.margin = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"multimodal:\") {" + LF +
  "                p.multimodal = Some(rest.trim() == \"true\");" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"note:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.note = Some(v.trim_matches('\"').to_string());" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    if let Some(prev) = current.take() {" + LF +
  "        out.push(prev);" + LF +
  "    }" + LF +
  "    out" + LF +
  "}" + LF + LF +
  "pub fn save_enabled_models(",
  "            current = Some(EnabledModel {" + LF +
  "                provider: rest.trim().to_string()," + LF +
  "                model: String::new()," + LF +
  "                id: None," + LF +
  "                context_window: None," + LF +
  "                max_tokens: None," + LF +
  "                multimodal: None," + LF +
  "                capabilities: None," + LF +
  "                note: None," + LF +
  "                margin: None," + LF +
  "                reasoning: None," + LF +
  "                probe_raw: None," + LF +
  "                probed_at: None," + LF +
  "            });" + LF +
  "            continue;" + LF +
  "        }" + LF +
  "        if let Some(p) = current.as_mut() {" + LF +
  "            if let Some(rest) = trimmed.strip_prefix(\"model:\") {" + LF +
  "                p.model = rest.trim().to_string();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"id:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.id = Some(v.trim_matches('\"').to_string());" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"context_window:\") {" + LF +
  "                p.context_window = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"max_tokens:\") {" + LF +
  "                p.max_tokens = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"margin:\") {" + LF +
  "                p.margin = rest.trim().parse().ok();" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"reasoning:\") {" + LF +
  "                let v = rest.trim().trim_matches('\"').to_string();" + LF +
  "                p.reasoning = if v.is_empty() { None } else { Some(v) };" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"multimodal:\") {" + LF +
  "                p.multimodal = Some(rest.trim() == \"true\");" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"note:\") {" + LF +
  "                let v = rest.trim();" + LF +
  "                p.note = Some(v.trim_matches('\"').to_string());" + LF +
  "            } else if let Some(rest) = trimmed.strip_prefix(\"#\") {" + LF +
  "                let comment = rest.trim();" + LF +
  "                if let Some(v) = comment.strip_prefix(\"probe_raw:\") {" + LF +
  "                    p.probe_raw = v.trim().parse().ok();" + LF +
  "                } else if let Some(v) = comment.strip_prefix(\"probed_at:\") {" + LF +
  "                    p.probed_at = Some(v.trim().to_string());" + LF +
  "                }" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    if let Some(prev) = current.take() {" + LF +
  "        out.push(prev);" + LF +
  "    }" + LF +
  "    out" + LF +
  "}" + LF + LF +
  "pub fn save_enabled_models("
);
console.log("Edit 3 done (read_discovered)");

/* === Edit 4: render_enabled_block === */
findReplace(
  "        if let Some(mg) = m.margin {" + LF +
  "            if (0.0..=1.0).contains(&mg) {" + LF +
  "                s.push_str(&format!(\"      margin: {:.2}\\n\", mg));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(mm) = m.multimodal {" + LF +
  "            s.push_str(&format!(\"      multimodal: {}\\n\", if mm { \"true\" } else { \"false\" }));" + LF +
  "        }" + LF +
  "        if let Some(cap) = &m.capabilities {" + LF +
  "            let mut any = false;" + LF +
  "            s.push_str(\"      capabilities:\\n\");" + LF +
  "            let pairs = [" + LF +
  "                (\"text\", cap.text)," + LF +
  "                (\"image_input\", cap.image_input)," + LF +
  "                (\"audio_input\", cap.audio_input)," + LF +
  "                (\"video_input\", cap.video_input)," + LF +
  "                (\"image_output\", cap.image_output)," + LF +
  "                (\"audio_output\", cap.audio_output)," + LF +
  "                (\"tool_use\", cap.tool_use)," + LF +
  "                (\"stream\", cap.stream)," + LF +
  "            ];" + LF +
  "            for (k, v) in pairs {" + LF +
  "                if let Some(b) = v {" + LF +
  "                    s.push_str(&format!(\"        {}: {}\\n\", k, if b { \"true\" } else { \"false\" }));" + LF +
  "                    any = true;" + LF +
  "                }" + LF +
  "            }" + LF +
  "            if !any {" + LF +
  "                // nothing tracked under capabilities, leave the section off" + LF +
  "                let trim_end = s.len() - \"      capabilities:\\n\".len();" + LF +
  "                s.truncate(trim_end);" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(note) = &m.note {" + LF +
  "            if !note.is_empty() {" + LF +
  "                s.push_str(&format!(\"      note: \\\"{}\\\"\\n\", note.replace('\"', \"\\\\\\\"\")));" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    s" + LF +
  "}" + LF + LF +
  "fn render_discovered_block(items: &[EnabledModel]) -> String {",
  "        if let Some(mg) = m.margin {" + LF +
  "            if (0.0..=1.0).contains(&mg) {" + LF +
  "                s.push_str(&format!(\"      margin: {:.2}\\n\", mg));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(rs) = &m.reasoning {" + LF +
  "            if !rs.is_empty() {" + LF +
  "                s.push_str(&format!(\"      reasoning: \\\"{}\\\"\\n\", rs.replace('\"', \"\\\\\\\"\")));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(pr) = m.probe_raw {" + LF +
  "            s.push_str(&format!(\"      # probe_raw: {}\\n\", pr));" + LF +
  "        }" + LF +
  "        if let Some(pa) = &m.probed_at {" + LF +
  "            if !pa.is_empty() {" + LF +
  "                s.push_str(&format!(\"      # probed_at: {}\\n\", pa));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(mm) = m.multimodal {" + LF +
  "            s.push_str(&format!(\"      multimodal: {}\\n\", if mm { \"true\" } else { \"false\" }));" + LF +
  "        }" + LF +
  "        if let Some(cap) = &m.capabilities {" + LF +
  "            let mut any = false;" + LF +
  "            s.push_str(\"      capabilities:\\n\");" + LF +
  "            let pairs = [" + LF +
  "                (\"text\", cap.text)," + LF +
  "                (\"image_input\", cap.image_input)," + LF +
  "                (\"audio_input\", cap.audio_input)," + LF +
  "                (\"video_input\", cap.video_input)," + LF +
  "                (\"image_output\", cap.image_output)," + LF +
  "                (\"audio_output\", cap.audio_output)," + LF +
  "                (\"tool_use\", cap.tool_use)," + LF +
  "                (\"stream\", cap.stream)," + LF +
  "            ];" + LF +
  "            for (k, v) in pairs {" + LF +
  "                if let Some(b) = v {" + LF +
  "                    s.push_str(&format!(\"        {}: {}\\n\", k, if b { \"true\" } else { \"false\" }));" + LF +
  "                    any = true;" + LF +
  "                }" + LF +
  "            }" + LF +
  "            if !any {" + LF +
  "                // nothing tracked under capabilities, leave the section off" + LF +
  "                let trim_end = s.len() - \"      capabilities:\\n\".len();" + LF +
  "                s.truncate(trim_end);" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(note) = &m.note {" + LF +
  "            if !note.is_empty() {" + LF +
  "                s.push_str(&format!(\"      note: \\\"{}\\\"\\n\", note.replace('\"', \"\\\\\\\"\")));" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    s" + LF +
  "}" + LF + LF +
  "fn render_discovered_block(items: &[EnabledModel]) -> String {"
);
console.log("Edit 4 done (render_enabled)");

/* === Edit 5: render_discovered_block === */
findReplace(
  "        if let Some(mg) = m.margin {" + LF +
  "            if (0.0..=1.0).contains(&mg) {" + LF +
  "                s.push_str(&format!(\"      margin: {:.2}\\n\", mg));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(mm) = m.multimodal {" + LF +
  "            s.push_str(&format!(\"      multimodal: {}\\n\", if mm { \"true\" } else { \"false\" }));" + LF +
  "        }" + LF +
  "        if let Some(cap) = &m.capabilities {" + LF +
  "            let mut any = false;" + LF +
  "            s.push_str(\"      capabilities:\\n\");" + LF +
  "            let pairs = [" + LF +
  "                (\"text\", cap.text)," + LF +
  "                (\"image_input\", cap.image_input)," + LF +
  "                (\"audio_input\", cap.audio_input)," + LF +
  "                (\"video_input\", cap.video_input)," + LF +
  "                (\"image_output\", cap.image_output)," + LF +
  "                (\"audio_output\", cap.audio_output)," + LF +
  "                (\"tool_use\", cap.tool_use)," + LF +
  "                (\"stream\", cap.stream)," + LF +
  "            ];" + LF +
  "            for (k, v) in pairs {" + LF +
  "                if let Some(b) = v {" + LF +
  "                    s.push_str(&format!(\"        {}: {}\\n\", k, if b { \"true\" } else { \"false\" }));" + LF +
  "                    any = true;" + LF +
  "                }" + LF +
  "            }" + LF +
  "            if !any {" + LF +
  "                let trim_end = s.len() - \"      capabilities:\\n\".len();" + LF +
  "                s.truncate(trim_end);" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(note) = &m.note {" + LF +
  "            if !note.is_empty() {" + LF +
  "                s.push_str(&format!(\"      note: \\\"{}\\\"\\n\", note.replace('\"', \"\\\\\\\"\")));" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    s",
  "        if let Some(mg) = m.margin {" + LF +
  "            if (0.0..=1.0).contains(&mg) {" + LF +
  "                s.push_str(&format!(\"      margin: {:.2}\\n\", mg));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(rs) = &m.reasoning {" + LF +
  "            if !rs.is_empty() {" + LF +
  "                s.push_str(&format!(\"      reasoning: \\\"{}\\\"\\n\", rs.replace('\"', \"\\\\\\\"\")));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(pr) = m.probe_raw {" + LF +
  "            s.push_str(&format!(\"      # probe_raw: {}\\n\", pr));" + LF +
  "        }" + LF +
  "        if let Some(pa) = &m.probed_at {" + LF +
  "            if !pa.is_empty() {" + LF +
  "                s.push_str(&format!(\"      # probed_at: {}\\n\", pa));" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(mm) = m.multimodal {" + LF +
  "            s.push_str(&format!(\"      multimodal: {}\\n\", if mm { \"true\" } else { \"false\" }));" + LF +
  "        }" + LF +
  "        if let Some(cap) = &m.capabilities {" + LF +
  "            let mut any = false;" + LF +
  "            s.push_str(\"      capabilities:\\n\");" + LF +
  "            let pairs = [" + LF +
  "                (\"text\", cap.text)," + LF +
  "                (\"image_input\", cap.image_input)," + LF +
  "                (\"audio_input\", cap.audio_input)," + LF +
  "                (\"video_input\", cap.video_input)," + LF +
  "                (\"image_output\", cap.image_output)," + LF +
  "                (\"audio_output\", cap.audio_output)," + LF +
  "                (\"tool_use\", cap.tool_use)," + LF +
  "                (\"stream\", cap.stream)," + LF +
  "            ];" + LF +
  "            for (k, v) in pairs {" + LF +
  "                if let Some(b) = v {" + LF +
  "                    s.push_str(&format!(\"        {}: {}\\n\", k, if b { \"true\" } else { \"false\" }));" + LF +
  "                    any = true;" + LF +
  "                }" + LF +
  "            }" + LF +
  "            if !any {" + LF +
  "                let trim_end = s.len() - \"      capabilities:\\n\".len();" + LF +
  "                s.truncate(trim_end);" + LF +
  "            }" + LF +
  "        }" + LF +
  "        if let Some(note) = &m.note {" + LF +
  "            if !note.is_empty() {" + LF +
  "                s.push_str(&format!(\"      note: \\\"{}\\\"\\n\", note.replace('\"', \"\\\\\\\"\")));" + LF +
  "            }" + LF +
  "        }" + LF +
  "    }" + LF +
  "    s"
);
console.log("Edit 5 done (render_discovered)");

/* === Edit 6: sample_items test === */
findReplace(
  "    fn sample_items() -> Vec<EnabledModel> {" + LF +
  "        vec![EnabledModel {" + LF +
  "            provider: \"minnimax\".to_string()," + LF +
  "            model: \"MiniMax-M3\".to_string()," + LF +
  "            id: None," + LF +
  "            context_window: Some(1000000)," + LF +
  "            max_tokens: Some(16384)," + LF +
  "            multimodal: None," + LF +
  "            capabilities: None," + LF +
  "            note: None," + LF +
  "        }]" + LF +
  "    }",
  "    fn sample_items() -> Vec<EnabledModel> {" + LF +
  "        vec![EnabledModel {" + LF +
  "            provider: \"minnimax\".to_string()," + LF +
  "            model: \"MiniMax-M3\".to_string()," + LF +
  "            id: None," + LF +
  "            context_window: Some(1000000)," + LF +
  "            max_tokens: Some(16384)," + LF +
  "            multimodal: None," + LF +
  "            capabilities: None," + LF +
  "            note: None," + LF +
  "            margin: None," + LF +
  "            reasoning: None," + LF +
  "            probe_raw: None," + LF +
  "            probed_at: None," + LF +
  "        }]" + LF +
  "    }"
);
console.log("Edit 6 done (sample_items)");

/* === Edit 7: rendered_block test === */
findReplace(
  "    fn rendered_block_is_well_formed_yaml_for_all_caps() {" + LF +
  "        let item = EnabledModel {" + LF +
  "            provider: \"minnimax\".to_string()," + LF +
  "            model: \"MiniMax-M3\".to_string()," + LF +
  "            id: None," + LF +
  "            context_window: Some(1000000)," + LF +
  "            max_tokens: Some(16384)," + LF +
  "            multimodal: Some(true)," + LF +
  "            capabilities: Some(ModelCapabilities {" + LF +
  "                text: Some(true)," + LF +
  "                image_input: Some(true)," + LF +
  "                audio_input: Some(true)," + LF +
  "                video_input: None," + LF +
  "                image_output: None," + LF +
  "                audio_output: None," + LF +
  "                tool_use: Some(true)," + LF +
  "                stream: Some(true)," + LF +
  "            })," + LF +
  "            note: Some(\"hello\".to_string())," + LF +
  "        };",
  "    fn rendered_block_is_well_formed_yaml_for_all_caps() {" + LF +
  "        let item = EnabledModel {" + LF +
  "            provider: \"minnimax\".to_string()," + LF +
  "            model: \"MiniMax-M3\".to_string()," + LF +
  "            id: None," + LF +
  "            context_window: Some(1000000)," + LF +
  "            max_tokens: Some(16384)," + LF +
  "            multimodal: Some(true)," + LF +
  "            capabilities: Some(ModelCapabilities {" + LF +
  "                text: Some(true)," + LF +
  "                image_input: Some(true)," + LF +
  "                audio_input: Some(true)," + LF +
  "                video_input: None," + LF +
  "                image_output: None," + LF +
  "                audio_output: None," + LF +
  "                tool_use: Some(true)," + LF +
  "                stream: Some(true)," + LF +
  "            })," + LF +
  "            note: Some(\"hello\".to_string())," + LF +
  "            margin: None," + LF +
  "            reasoning: None," + LF +
  "            probe_raw: None," + LF +
  "            probed_at: None," + LF +
  "        };"
);
console.log("Edit 7 done (rendered_block)");

/* === Edit 8: debug_crlf_backup test === */
findReplace(
  "        let raw = \"server:\\r\\n  port: 5678\\r\\ndefault_provider: minimax\\r\\nproviders:\\r\\n  minimax:\\r\\n    spec: minimax\\r\\n    credentials:\\r\\n      api_key: gw-x\\r\\n    endpoint:\\r\\n      base_url: https://minnimax.chat/v1\\r\\nmodels:\\r\\n  aliases:\\r\\n    '*': minimax/MiniMax-M3\\r\\nsession:\\r\\n  backend: sqlite\\r\\n\";        let items = vec![EnabledModel {" + LF +
  "            provider: \"minimax\".to_string()," + LF +
  "            model: \"MiniMax-M3\".to_string()," + LF +
  "            id: None," + LF +
  "            context_window: Some(1000000)," + LF +
  "            max_tokens: Some(16384)," + LF +
  "            multimodal: None," + LF +
  "            capabilities: None," + LF +
  "            note: None," + LF +
  "        }];",
  "        let raw = \"server:\\r\\n  port: 5678\\r\\ndefault_provider: minimax\\r\\nproviders:\\r\\n  minimax:\\r\\n    spec: minimax\\r\\n    credentials:\\r\\n      api_key: gw-x\\r\\n    endpoint:\\r\\n      base_url: https://minnimax.chat/v1\\r\\nmodels:\\r\\n  aliases:\\r\\n    '*': minimax/MiniMax-M3\\r\\nsession:\\r\\n  backend: sqlite\\r\\n\";        let items = vec![EnabledModel {" + LF +
  "            provider: \"minimax\".to_string()," + LF +
  "            model: \"MiniMax-M3\".to_string()," + LF +
  "            id: None," + LF +
  "            context_window: Some(1000000)," + LF +
  "            max_tokens: Some(16384)," + LF +
  "            multimodal: None," + LF +
  "            capabilities: None," + LF +
  "            note: None," + LF +
  "            margin: None," + LF +
  "            reasoning: None," + LF +
  "            probe_raw: None," + LF +
  "            probed_at: None," + LF +
  "        }];"
);
console.log("Edit 8 done (debug_crlf_backup)");

fs.writeFileSync(path, s);
console.log("OK: wrote", path);