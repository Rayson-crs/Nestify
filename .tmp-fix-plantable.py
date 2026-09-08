from pathlib import Path

p = Path(r"apps/desktop/src/components/workspace/PlanTable.tsx")
text = p.read_text(encoding="utf-8")
start = text.index("export function PlanTable")
p.write_text(
    """import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ChangePlan, PlanOp } from '@/lib/ipc'
import { opLabel } from '@/lib/labels'

"""
    + text[start:],
    encoding="utf-8",
)
print("plan table cleaned", p.stat().st_size)
