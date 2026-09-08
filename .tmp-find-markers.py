from pathlib import Path
lines = Path(r"apps/desktop/src/App.tsx").read_text(encoding="utf-8").splitlines()
for name in ["handleAddLibrary","handleSendSelectionTo","handleUpdateLibrary","selectionKey","handleJobRollback","selectedCount"]:
    print(name, next(i+1 for i,l in enumerate(lines) if l.startswith("  const "+name)))
