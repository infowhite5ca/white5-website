from pathlib import Path
import re

FONT_PATTERN = re.compile(r"White5-Regular Font\.ttf(?:\?v=[^'\"\)\s]+)?")
FONT_URL = "White5-Regular Font.ttf?v=001002"

changed = []
for extension in ("*.html", "*.htm", "*.css", "*.js"):
    for path in Path(".").rglob(extension):
        if ".git" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        updated = FONT_PATTERN.sub(FONT_URL, text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed.append(str(path))

print("Updated:")
for path in sorted(set(changed)):
    print(path)
