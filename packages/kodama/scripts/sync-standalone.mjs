#!/usr/bin/env node
// Sync this monorepo's Kodama package into the standalone Syfyivan/kodama repo.
//
// Why two repos: the standalone repo is for people who only want the desktop pet;
// the monorepo (packages/kodama) is for people who use the pet + the Lark bridge
// together. The monorepo is the single source of truth for Kodama's code, so this
// script pushes its tracked sources outward to the standalone clone.
//
// What it does: copies every git-tracked file under packages/kodama into the
// standalone repo, preserving paths (packages/kodama/src/... -> src/...). It reads
// the *working tree* (not HEAD), so locally-applied fixes are included.
//
// What it deliberately leaves alone:
//   - package.json   identity differs on purpose (repo name / version / packaging);
//                    its drift is reported, never overwritten.
//   - this script    stays monorepo-only.
//   - render.local.js & other gitignored assets (vendor/, models/, private pets):
//                    not tracked, so never copied — the standalone keeps its own.
//
// Copy-only: files deleted in the monorepo are NOT removed from the standalone
// (reported as a heads-up). Run from anywhere:  node scripts/sync-standalone.mjs [destDir]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PKG_DIR = path.resolve(import.meta.dirname, '..')      // .../packages/kodama
const MONO_ROOT = path.resolve(PKG_DIR, '..', '..')          // .../lark-codex-bridge
const DEST = path.resolve(
  process.argv[2] || process.env.KODAMA_STANDALONE || path.join(process.env.HOME || '', 'code', 'kodama'),
)

// Files we never overwrite in the standalone (it owns its identity / packaging).
const SKIP = new Set(['package.json', 'scripts/sync-standalone.mjs'])

if (!fs.existsSync(path.join(DEST, '.git'))) {
  console.error(`✗ destination is not a git repo: ${DEST}`)
  console.error('  pass the standalone repo path: node scripts/sync-standalone.mjs /path/to/kodama')
  process.exit(1)
}

const tracked = execFileSync('git', ['-C', MONO_ROOT, 'ls-files', 'packages/kodama'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((p) => p.replace(/^packages\/kodama\//, ''))

let copied = 0
const skipped = []
for (const rel of tracked) {
  if (SKIP.has(rel)) { skipped.push(rel); continue }
  const src = path.join(PKG_DIR, rel)
  if (!fs.existsSync(src)) continue
  const dst = path.join(DEST, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  copied++
}

console.log(`✓ synced ${copied} tracked files → ${DEST}`)
if (skipped.length) console.log(`· left untouched (managed per-repo): ${skipped.join(', ')}`)

// Report package.json drift so the maintainer can reconcile deliberately.
try {
  const a = fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')
  const b = fs.readFileSync(path.join(DEST, 'package.json'), 'utf8')
  if (a !== b) console.log('· note: package.json differs (expected: repo name / version / packaging) — reconcile by hand if needed')
} catch { /* standalone may lack one; ignore */ }

// Heads-up for files that exist in the standalone but are no longer tracked here.
try {
  const destTracked = execFileSync('git', ['-C', DEST, 'ls-files', 'src', 'scripts', 'docs', 'test'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
  const monoSet = new Set(tracked)
  const stale = destTracked.filter((p) => !monoSet.has(p) && !SKIP.has(p))
  if (stale.length) console.log(`· standalone has files no longer in the monorepo (not deleted): ${stale.join(', ')}`)
} catch { /* best-effort */ }
