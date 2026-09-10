import type { DatabaseSync } from "node:sqlite";

export function gramsForName(name: string): string[] {
  const lower = name.toLowerCase();
  const sources = new Set<string>([lower]);
  const stem = stemWithoutExt(lower);
  if (stem !== lower) {
    sources.add(stem);
  }

  const grams = new Set<string>();
  for (const source of sources) {
    if (source.length === 0) {
      continue;
    }
    if (source.length < 3) {
      grams.add(source);
      continue;
    }
    for (let i = 0; i <= source.length - 3; i++) {
      grams.add(source.slice(i, i + 3));
    }
    if (containsCjk(source)) {
      for (let i = 0; i < source.length; i++) {
        const gram = source.slice(i, i + 1);
        if (containsCjk(gram)) grams.add(gram);
      }
      for (let i = 0; i <= source.length - 2; i++) {
        const gram = source.slice(i, i + 2);
        if (containsCjk(gram)) grams.add(gram);
      }
    }
  }
  return [...grams];
}

export function insertTrigrams(db: DatabaseSync, entryId: string, name: string): void {
  db.prepare(`DELETE FROM name_trigrams WHERE entry_id = ?`).run(entryId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO name_trigrams(entry_id, gram) VALUES (?, ?)`,
  );
  for (const gram of gramsForName(name)) {
    insert.run(entryId, gram);
  }
}

function stemWithoutExt(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return name;
  }
  return name.slice(0, dot);
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}
