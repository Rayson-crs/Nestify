import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { readQuickVideoDuration } from "./quick-duration.ts"

test("quick duration reads an mvhd version 0 header without scanning media data", async () => {
  const root = await mkdtemp(join(tmpdir(), "nestify-duration-"))
  const path = join(root, "clip.mp4")
  try {
    await writeFile(path, sampleMp4())
    assert.equal(await readQuickVideoDuration(path), 12.5)
    assert.equal(await readQuickVideoDuration(join(root, "clip.avi")), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function sampleMp4(): Buffer {
  const ftyp = box("ftyp", Buffer.from("isom"))
  const mvhd = Buffer.alloc(20)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE(12500, 16)
  const moov = box("moov", box("mvhd", mvhd))
  const mdat = box("mdat", Buffer.alloc(64, 1))
  return Buffer.concat([ftyp, moov, mdat])
}

function box(type: string, content: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + content.length)
  header.write(type, 4, "latin1")
  return Buffer.concat([header, content])
}
