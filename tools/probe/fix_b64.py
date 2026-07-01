import re
content = open(r"D:\Documents\VibeCoding\GodeX\tools\_b64_assets.rs", "r", encoding="utf-8").read()
def fix_block(match):
    name = match.group(1)
    lines = match.group(2).strip().split(chr(10))
    b64 = "".join(line.strip().rstrip(",").strip().strip(chr(34)) for line in lines)
    return "pub const " + name + ": &str = " + chr(34) + b64 + chr(34) + ";"
new_content = re.sub(
    r"pub const (\w+_B64): &str =\s*\n((?:\s+\".*?\"\s*,?\s*\n)+);",
    fix_block, content, flags=re.MULTILINE
)
new_content = re.sub(r"// (\w+\.\w+) b64 len: \d+", r"// \1 b64 (single-line)", new_content)
out = r"D:\Documents\VibeCoding\GodeX\tools\probe\b64_assets_single.rs"
open(out, "w", encoding="utf-8").write(new_content)
print("Wrote", out, "size:", len(new_content))
print(new_content[:500])
