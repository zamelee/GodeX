src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src/index.html"
c = open(src, "r", encoding="utf-8").read()
# Find the finally block in startProbeRun
import re
# The current finally block has btn.disabled = false; btn.textContent = "开始探测";
# We add an unlisten before it
# Use a regex to match the pattern
pattern = re.compile(
    r"(\\} finally \\{\\s*\\n)(    btn\\.disabled = false;\\s*\\n    btn\\.textContent = \"开始探测\";)",
    re.MULTILINE
)
new_c, count = pattern.subn(
    r"\\1    if (_unlistenProbe) { try { _unlistenProbe(); } catch (e) {} _unlistenProbe = null; }\\n    \\2",
    c
)
if count > 0:
    open(src, "w", encoding="utf-8").write(new_c)
    print("Added unlisten (regex), count =", count)
else:
    print("Pattern not found, trying simpler approach")
    # Just find the exact text
    target = chr(125) + " finally {" + chr(10) + "    btn.disabled = false;" + chr(10) + "    btn.textContent = " + chr(34) + "开始探测" + chr(34) + ";"
    if target in c:
        # Find position
        idx = c.find(target)
        # Insert unlisten before btn.disabled
        unlisten = "    if (_unlistenProbe) { try { _unlistenProbe(); } catch (e) {} _unlistenProbe = null; }" + chr(10) + "    "
        c2 = c[:idx + len(chr(125) + " finally {") + 2] + unlisten + c[idx + len(chr(125) + " finally {") + 2:]
        open(src, "w", encoding="utf-8").write(c2)
        print("Added unlisten (manual)")
    else:
        print("still not found")
