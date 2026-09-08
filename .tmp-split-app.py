from pathlib import Path
import re

root = Path(r"apps/desktop/src")
app_path = root / "App.tsx"
text = app_path.read_text(encoding="utf-8")
lines = text.splitlines()

# Locate function body
start = next(i for i, line in enumerate(lines) if line.startswith("export default function App()"))
ret = next(i for i, line in enumerate(lines) if i > start and line.startswith("  return ("))
add = next(i for i, line in enumerate(lines) if line.startswith("  const handleAddLibrary"))
derived = next(i for i, line in enumerate(lines) if line.startswith("  const selectedCount"))

data_body = lines[start + 1 : add]
actions_body = lines[add:derived]
derived_body = lines[derived:ret]
jsx = "\n".join(lines[ret:])

# Collect top-level const names in data body
names = []
for line in data_body:
    m = re.match(r"  const \[([A-Za-z0-9]+), ([A-Za-z0-9]+)\] =", line)
    if m:
        names.extend([m.group(1), m.group(2)])
        continue
    m = re.match(r"  const ([A-Za-z0-9]+) =", line)
    if m:
        names.append(m.group(1))

derived_names = []
for line in derived_body:
    m = re.match(r"  const ([A-Za-z0-9]+) =", line)
    if m:
        derived_names.append(m.group(1))

action_names = []
for line in actions_body:
    m = re.match(r"  const ([A-Za-z0-9]+) =", line)
    if m:
        action_names.append(m.group(1))

print("data names", len(names))
print("derived", derived_names)
print("action names", action_names)
print("data_body", len(data_body), "actions_body", len(actions_body), "derived", len(derived_body), "jsx_lines", len(lines)-ret)
print("markers", start, add, derived, ret, "total", len(lines))
