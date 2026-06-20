// `pnpm run check` — syntax-check every source file. Renderer files use ESM but
// have a .js extension (loaded via <script type="module">), so `node --check`
// would treat them as CommonJS; we copy those to a temp .mjs first.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CJS = [
  'src/main/index.js',
  'src/main/preload.js',
  'src/main/hook-events.js',
  'src/main/token-usage.js',
  'src/main/pomodoro.js',
]
const ESM = [
  'src/renderer/renderer.js',
  'src/renderer/bridge-tasks.js',
  'src/renderer/agent-sync.js',
  'src/renderer/accessories.js',
  'src/renderer/reactions.js',
  'src/renderer/growth.js',
  'src/renderer/config/accessories.js',
  'src/renderer/backends/gif.js',
  'src/renderer/config/pet-config.js',
  'src/renderer/config/render.local.example.js',
  'src/renderer/config/agent.local.example.js',
  'src/renderer/config/accessories.local.example.js',
  'scripts/setup-assets.mjs',
  'scripts/kodama-control.mjs',
  'scripts/start-detached.mjs',
  'scripts/check.mjs',
]

const dir = mkdtempSync(join(tmpdir(), 'kodama-check-'))
let failed = 0

function check(file, asModule) {
  try {
    let target = file
    if (asModule && file.endsWith('.js')) {
      target = join(dir, file.replace(/[/\\]/g, '_') + '.mjs')
      writeFileSync(target, readFileSync(file))
    }
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
    console.log('ok   ', file)
  } catch (e) {
    failed += 1
    console.error('FAIL ', file, '\n', e.stderr?.toString() || e.message)
  }
}

for (const f of CJS) check(f, false)
for (const f of ESM) check(f, true)

console.log(`\n${failed ? `${failed} file(s) failed` : 'all files OK'}`)
process.exit(failed ? 1 : 0)
