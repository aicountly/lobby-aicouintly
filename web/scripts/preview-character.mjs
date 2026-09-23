/**
 * Render a character from every side and in every expression, to PNG.
 *
 *   node scripts/preview-character.mjs public/lobby-assets/receptionist.glb out/dir
 *
 * Development only: it serves scripts/preview/character-preview.html, which is
 * not part of the app bundle. The point is to judge a character WITHOUT the
 * room, the HUD or the conversation panel in front of it — all three have hidden
 * the mouth at some point while a face was being reviewed.
 *
 * Expressions are driven by writing morph influences directly, using the
 * normalised ARKit names in the model's mapping file, so this also proves the
 * mapping is real rather than declared.
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const [, , modelArg, outArg] = process.argv
const model = resolve(modelArg ?? 'public/lobby-assets/receptionist.glb')
const outDir = resolve(outArg ?? 'preview-out')
if (!existsSync(model)) {
  console.error(`No model at ${model}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

/** The views a reviewer needs: every side, plus the face close enough to judge. */
const VIEWS = [
  ['front', 0, 'full'],
  ['three-quarter', 40, 'full'],
  ['side', 90, 'full'],
  ['rear', 180, 'full'],
]

/**
 * Expressions, in the lobby's own ARKit control names.
 *
 * Deliberately restrained: the brief asks for a warm professional face, not a
 * grin, so `smile` is a half-strength mouthSmile rather than 1.0.
 */
const EXPRESSIONS = [
  ['neutral', {}],
  ['smile', { mouthSmileLeft: 0.45, mouthSmileRight: 0.45, cheekSquintLeft: 0.2, cheekSquintRight: 0.2 }],
  ['blink', { eyeBlinkLeft: 1, eyeBlinkRight: 1 }],
  ['mouth-open', { jawOpen: 0.55 }],
  ['speaking', { viseme_aa: 0.8, jawOpen: 0.3 }],
]

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' }
const THREE_DIR = resolve(HERE, '..', 'node_modules', 'three')

const server = http.createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  let file
  if (path === '/' || path === '/index.html') file = join(HERE, 'preview', 'character-preview.html')
  else if (path === '/model.glb') file = model
  else if (path.startsWith('/three/')) file = join(THREE_DIR, path.slice('/three/'.length))
  else file = join(HERE, 'preview', path)

  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404)
    return res.end('not found')
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((done) => server.listen(4310, done))

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try {
    return require('playwright')
  } catch {
    return require(`${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright`)
  }
})()

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await (await browser.newContext({ viewport: { width: 460, height: 720 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:4310/', { waitUntil: 'load' })
await page.waitForFunction(() => window.__previewReady, null, { timeout: 60_000 })

const info = await page.evaluate(() => ({ height: window.__preview.height, morphs: window.__preview.morphNames.length }))
console.log(`  model height ${info.height.toFixed(3)} m, ${info.morphs} morph controls`)

/**
 * Settle the arms before the orbit views.
 *
 * The bind pose holds the arms out, and reviewing a character in it answers a
 * question nobody asked: what matters is how she looks standing at the desk.
 * These are the same angles skeletonPoser.ts applies for this rig convention.
 */
const RIG_REST = [
  ['Bip01_L_UpperArm', [0, 0.72, 0]],
  ['Bip01_R_UpperArm', [0, -0.72, 0]],
  ['Bip01_L_Forearm', [0, -0.18, 0]],
  ['Bip01_R_Forearm', [0, -0.18, 0]],
]
const posed = await page.evaluate(
  (rest) => rest.map(([name, [x, y, z]]) => window.__preview.bone(name, x, y, z)),
  RIG_REST,
)
console.log(`  rest pose applied to ${posed.filter(Boolean).length}/${RIG_REST.length} bones`)

for (const [name, yaw, mode] of VIEWS) {
  await page.evaluate(([y, m]) => window.__preview.view(y, m), [yaw, mode])
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(outDir, `view-${name}.png`) })
  console.log(`  view-${name}.png`)
}

await page.evaluate(() => window.__preview.view(0, 'head'))
for (const [name, pose] of EXPRESSIONS) {
  await page.evaluate((p) => window.__preview.expression(p), pose)
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(outDir, `face-${name}.png`) })
  console.log(`  face-${name}.png`)
}

// Greeting: posed on the bones, the same way the lobby poses a clipless rig.
await page.evaluate(() => {
  window.__preview.expression({ mouthSmileLeft: 0.4, mouthSmileRight: 0.4 })
  window.__preview.bone('Bip01_L_UpperArm', 0, 0.72, 0)
  window.__preview.bone('Bip01_R_UpperArm', 0, 1.05, 0)
  window.__preview.bone('Bip01_R_Forearm', 0, 1.2, 0)
})
await page.evaluate(() => window.__preview.view(0, 'full'))
await page.waitForTimeout(600)
await page.screenshot({ path: join(outDir, 'pose-greeting.png') })
console.log('  pose-greeting.png')

await browser.close()
server.close()
if (errors.length) {
  console.error('page errors:', errors.slice(0, 3).join(' | '))
  process.exit(1)
}
console.log(`\nWrote ${VIEWS.length + EXPRESSIONS.length + 1} images to ${outDir}`)
