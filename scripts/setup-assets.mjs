// Downloads the rendering stack + a Live2D sample model into local folders so
// Kodama runs fully offline (no CDN at runtime). These assets are .gitignored:
// Cubism Core and the official sample model are proprietary / redistribution-
// restricted, so we fetch them on setup rather than commit them.
//
// Usage: pnpm run setup
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(ROOT, 'src/renderer/vendor')
const MODELS = join(ROOT, 'src/renderer/models')

const LIBS = [
  ['https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js', 'pixi.min.js'],
  ['https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js', 'cubism4.min.js'],
  // Cubism Core is proprietary and cannot be served from npm — official CDN only.
  ['https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js', 'live2dcubismcore.min.js'],
]

const MODEL_BASE = 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/test/assets/haru/'
const MODEL_ENTRY = 'haru_greeter_t03.model3.json'

async function dl(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} <- ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

async function save(buf, path) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buf)
}

function collectModelRefs(model) {
  const refs = new Set()
  const fr = model.FileReferences || {}
  for (const key of ['Moc', 'Physics', 'Pose', 'DisplayInfo', 'UserData']) {
    if (fr[key]) refs.add(fr[key])
  }
  for (const t of fr.Textures || []) refs.add(t)
  for (const exp of fr.Expressions || []) if (exp.File) refs.add(exp.File)
  for (const group of Object.values(fr.Motions || {})) {
    for (const m of group) if (m.File) refs.add(m.File)
  }
  return [...refs]
}

async function main() {
  for (const [url, name] of LIBS) {
    process.stdout.write(`vendor: ${name} ... `)
    await save(await dl(url), join(VENDOR, name))
    console.log('ok')
  }

  process.stdout.write(`model: ${MODEL_ENTRY} ... `)
  const entryBuf = await dl(MODEL_BASE + MODEL_ENTRY)
  await save(entryBuf, join(MODELS, 'haru', MODEL_ENTRY))
  console.log('ok')

  const refs = collectModelRefs(JSON.parse(entryBuf.toString()))
  let failed = 0
  for (const rel of refs) {
    process.stdout.write(`  ${rel} ... `)
    try {
      await save(await dl(MODEL_BASE + rel), join(MODELS, 'haru', rel))
      console.log('ok')
    } catch (e) {
      // Some referenced files (cdi3/pose/userdata) are optional and may 404.
      failed += 1
      console.log(`skip (${e.message.split(' ')[0]})`)
    }
  }
  console.log(
    `\nDone: ${LIBS.length} libs + model (${refs.length - failed}/${refs.length} files; ${failed} optional missing).`,
  )
}

main().catch((e) => {
  console.error('\nsetup failed:', e.message)
  process.exit(1)
})
