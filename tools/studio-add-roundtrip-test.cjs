/* Add round-trip test for reasoning/probe_raw/probed_at in config.rs */
const fs = require("fs");
const path = "studio-tauri/src-tauri/src/config.rs";
let s = fs.readFileSync(path, "utf8");
const LF = "\n";
const old = "        assert!(!updated.contains(\"aliases:\"), \"old aliases: should be gone, got:\\n{}\", updated);" + LF + "        assert!(updated.contains(\"enabled:\"), \"new enabled: block should be present\");" + LF + "    }" + LF + "}";
const replacement = "        assert!(!updated.contains(\"aliases:\"), \"old aliases: should be gone, got:\\n{}\", updated);" + LF + "        assert!(updated.contains(\"enabled:\"), \"new enabled: block should be present\");" + LF + "    }" + LF + LF +
  "    /// Round-trip: yaml with # probe_raw / # probed_at comments, plus a reasoning line," + LF +
  "    /// must be readable as EnabledModel fields and re-emittable by render_enabled_block." + LF +
  "    #[test]" + LF +
  "    fn round_trip_preserves_probe_metadata_and_reasoning() {" + LF +
  "        let dir = std::env::temp_dir().join(\"godex_studio_round_trip\");" + LF +
  "        let _ = std::fs::create_dir_all(&dir);" + LF +
  "        let p = dir.join(\"config.yaml\");" + LF +
  "        let raw = \"server:\\n  port: 5678\\ndefault_provider: minimax\\nproviders:\\n  minimax:\\n    spec: minimax\\nmodels:\\n  enabled:\\n    - provider: minimax\\n      model: MiniMax-M3\\n      context_window: 1235000\\n      # probe_raw: 1300000\\n      # probed_at: 2026-06-27T10:00:00Z\\n      # probe_method: chat_completions\\n      margin: 0.95\\n      reasoning: \\\"max\\\"\\n\";" + LF +
  "        std::fs::write(&p, raw).unwrap();" + LF +
  "        let models = read_enabled_models(&p);" + LF +
  "        assert_eq!(models.len(), 1);" + LF +
  "        let m = &models[0];" + LF +
  "        assert_eq!(m.model, \"MiniMax-M3\");" + LF +
  "        assert_eq!(m.context_window, Some(1235000));" + LF +
  "        assert_eq!(m.probe_raw, Some(1300000), \"probe_raw comment not parsed\");" + LF +
  "        assert_eq!(m.probed_at.as_deref(), Some(\"2026-06-27T10:00:00Z\"), \"probed_at comment not parsed\");" + LF +
  "        assert_eq!(m.reasoning.as_deref(), Some(\"max\"), \"reasoning field not parsed\");" + LF +
  "        // Re-emit and check that probe_raw + probed_at + reasoning come back out." + LF +
  "        let out = render_enabled_block(&models);" + LF +
  "        assert!(out.contains(\"      reasoning: \\\"max\\\"\"), \"reasoning missing in re-emit:\\n{}\", out);" + LF +
  "        assert!(out.contains(\"      # probe_raw: 1300000\"), \"probe_raw missing in re-emit:\\n{}\", out);" + LF +
  "        assert!(out.contains(\"      # probed_at: 2026-06-27T10:00:00Z\"), \"probed_at missing in re-emit:\\n{}\", out);" + LF +
  "        let _ = std::fs::remove_file(&p);" + LF +
  "    }" + LF +
  "}";
if (!s.includes(old)) { console.error("CLOSING BRACE NOT FOUND"); process.exit(1); }
s = s.replace(old, replacement);
fs.writeFileSync(path, s);
console.log("OK: round-trip test added");