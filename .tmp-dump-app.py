from pathlib import Path
p = Path(r"apps/desktop/src/App.tsx")
lines = p.read_text(encoding="utf-8").splitlines()
# dump sections for inspection of first/last
for a,b,name in [(97,140,"fnstart"), (590,610,"add"), (1165,1210,"derived"), (1320,1360,"main"), (1610,1650,"footer")]:
    print("\n====", name, a+1, b, "====")
    print("\n".join(f"{i+1:4}|{lines[i]}" for i in range(a, min(b, len(lines)))))
