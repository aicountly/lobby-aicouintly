/**
 * What the reception character costs, measured rather than estimated.
 *
 *   npm run build && npm run measure:avatar
 *
 * Three configurations of the *same* room, at the same viewport, the same
 * quality profile and the same camera pose, because a comparison that changes
 * two things at once measures nothing:
 *
 *   A  environment only     ?lobbyCharacter=off
 *   B  + the character idle  ?lobbyCharacter=idle
 *   C  + speech animation    ?lobbyCharacter=speaking
 *
 * Draw calls, triangles, geometries, textures, programs and transferred bytes
 * are exact: they come from `WebGLRenderer.info` and the Resource Timing API and
 * do not depend on the GPU. **Frame time does not.** This container has no GPU
 * and Chromium falls back to SwiftShader, so the frame numbers describe a
 * software rasteriser and are reported as a ratio between configurations, which
 * is the only part of them that transfers. They are not a device benchmark and
 * must not be quoted as one.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { preview } from 'vite'

const require = createRequire(import.meta.url)

const MODES = ['off', 'idle', 'speaking']
const VIEWPORT = { width: 1280, height: 720 }
const QUALITY = 'balanced'
/**
 * At the counter, looking at the character.
 *
 * 1.95 m from the figure, which is both where a visitor would actually stand and
 * the pose where the character occupies the most screen — so the cost it adds is
 * measured near its worst case rather than at the far end of the room. The
 * camera's 0.38 m radius clears the counter collider (z −6.5…−4.7) by 0.17 m.
 */
const POSE = { x: 1.15, z: -4.15, yaw: -0.0768, pitch: 0.03 }
const FRAME_SAMPLES = 24
/** Hard ceiling per configuration. Three of these stays inside three minutes. */
const PER_MODE_TIMEOUT_MS = 50_000
const OUT_DIR = 'measurements'

function loadPlaywright() {
  const candidates = []
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH)
  candidates.push('playwright')
  try {
    candidates.push(`${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright`)
  } catch {
    // No global npm root; the other candidates may still work.
  }
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      // Try the next one.
    }
  }
  throw new Error(`Playwright not found. Tried: ${candidates.join(', ')}`)
}

/** Everything the page can tell us, gathered in one evaluate. */
const COLLECT = (samples) =>
  new Promise((resolve) => {
    const probe = window.__aicountlyLobbyMeasure
    const info = probe.renderer.info
    const frames = []
    let previous = performance.now()
    let taken = 0

    const tick = () => {
      const now = performance.now()
      frames.push(now - previous)
      previous = now
      taken += 1
      if (taken < samples) {
        requestAnimationFrame(tick)
        return
      }

      let shadowLights = 0
      let lights = 0
      probe.scene.traverse((node) => {
        if (node.isLight) {
          lights += 1
          if (node.castShadow) shadowLights += 1
        }
      })

      const resources = performance.getEntriesByType('resource')
      const transferred = resources.reduce((total, entry) => total + (entry.encodedBodySize || 0), 0)
      const decoded = resources.reduce((total, entry) => total + (entry.decodedBodySize || 0), 0)

      // Drop the first few: they include the frame the sampler itself started on.
      const settled = frames.slice(3).sort((a, b) => a - b)
      const median = settled[Math.floor(settled.length / 2)] ?? 0

      resolve({
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        lines: info.render.lines,
        points: info.render.points,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        lights,
        shadowLights,
        transferredBytes: transferred,
        decodedBytes: decoded,
        requests: resources.length,
        frameMsMedian: Number(median.toFixed(2)),
        frameMsMin: Number((settled[0] ?? 0).toFixed(2)),
        frameMsMax: Number((settled[settled.length - 1] ?? 0).toFixed(2)),
        samples: settled.length,
        renderer: (() => {
          try {
            const gl = probe.renderer.getContext()
            const ext = gl.getExtension('WEBGL_debug_renderer_info')
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
          } catch {
            return 'unknown'
          }
        })(),
        drawingBuffer: [probe.renderer.domElement?.width ?? 0, probe.renderer.domElement?.height ?? 0],
        mode: probe.mode,
      })
    }

    requestAnimationFrame(tick)
  })

async function measure(browser, baseUrl, mode) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const errors = []
  try {
    // The quality profile is a stored preference, so it has to be set before the
    // first render or configuration A runs at a different profile to B.
    await context.addInitScript((quality) => {
      try {
        window.localStorage.setItem('aicountly-lobby-quality', quality)
      } catch {
        // Blocked storage: the default profile is the same one anyway.
      }
    }, QUALITY)

    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`${baseUrl}?lobbyCharacter=${mode}`, { waitUntil: 'load', timeout: 25_000 })
    await page.waitForFunction(() => Boolean(window.__aicountlyLobbyMeasure), null, { timeout: 25_000 })
    await page.evaluate((pose) => window.__aicountlyLobbyMeasure.setPose?.(pose), POSE)
    // Textures decode and the environment map is generated after first paint;
    // measuring before they land would credit the character with their cost.
    await page.waitForTimeout(3500)

    const stats = await page.evaluate(COLLECT, FRAME_SAMPLES)
    mkdirSync(OUT_DIR, { recursive: true })
    await page.screenshot({ path: `${OUT_DIR}/character-${mode}.png` })

    // A speaking mouth is only visible across frames, so take a short series.
    if (mode === 'speaking') {
      for (let i = 0; i < 4; i += 1) {
        await page.waitForTimeout(700)
        await page.screenshot({ path: `${OUT_DIR}/character-speaking-${i + 1}.png` })
      }
    }

    return { ...stats, errors }
  } finally {
    await context.close()
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms)),
  ])
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`
}

if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first — measuring the dev server would measure Vite, not the lobby.')
  process.exit(2)
}

const { chromium } = loadPlaywright()
const server = await preview({ preview: { port: 4183, strictPort: true }, logLevel: 'error' })
const baseUrl = `http://localhost:4183/lobby`
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })

const measured = {}
let failed = false

try {
  for (const mode of MODES) {
    process.stdout.write(`measuring ${mode}… `)
    try {
      measured[mode] = await withTimeout(measure(browser, baseUrl, mode), PER_MODE_TIMEOUT_MS, mode)
      console.log('done')
    } catch (error) {
      failed = true
      console.log(`FAILED: ${error.message}`)
      measured[mode] = { error: error.message }
    }
  }
} finally {
  await browser.close()
  await server.close()
}

const a = measured.off
const b = measured.idle
const c = measured.speaking

const report = {
  measuredAt: new Date().toISOString(),
  viewport: VIEWPORT,
  quality: QUALITY,
  pose: POSE,
  frameSamples: FRAME_SAMPLES,
  note:
    'Frame timings come from a SwiftShader software rasteriser in a container with no GPU. They are comparable between these three configurations and are not a device benchmark.',
  configurations: measured,
  incremental:
    a && b && !a.error && !b.error
      ? {
          avatarOverEnvironment: {
            drawCalls: b.drawCalls - a.drawCalls,
            triangles: b.triangles - a.triangles,
            geometries: b.geometries - a.geometries,
            textures: b.textures - a.textures,
            programs: b.programs - a.programs,
            transferredBytes: b.transferredBytes - a.transferredBytes,
            frameMsMedian: Number((b.frameMsMedian - a.frameMsMedian).toFixed(2)),
            frameRatio: a.frameMsMedian ? Number((b.frameMsMedian / a.frameMsMedian).toFixed(3)) : null,
          },
          speechOverIdle:
            c && !c.error
              ? {
                  drawCalls: c.drawCalls - b.drawCalls,
                  triangles: c.triangles - b.triangles,
                  transferredBytes: c.transferredBytes - b.transferredBytes,
                  frameMsMedian: Number((c.frameMsMedian - b.frameMsMedian).toFixed(2)),
                  frameRatio: b.frameMsMedian ? Number((c.frameMsMedian / b.frameMsMedian).toFixed(3)) : null,
                }
              : null,
        }
      : null,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(`${OUT_DIR}/avatar-cost.json`, `${JSON.stringify(report, null, 2)}\n`)

const rows = [
  ['', 'A environment', 'B + character', 'C + speech'],
  ['draw calls', a?.drawCalls, b?.drawCalls, c?.drawCalls],
  ['triangles', a?.triangles, b?.triangles, c?.triangles],
  ['geometries', a?.geometries, b?.geometries, c?.geometries],
  ['textures', a?.textures, b?.textures, c?.textures],
  ['shader programs', a?.programs, b?.programs, c?.programs],
  ['shadow lights', a?.shadowLights, b?.shadowLights, c?.shadowLights],
  ['transferred', a && formatBytes(a.transferredBytes), b && formatBytes(b.transferredBytes), c && formatBytes(c.transferredBytes)],
  ['frame ms (median)', a?.frameMsMedian, b?.frameMsMedian, c?.frameMsMedian],
]

const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column] ?? '—').length)))
console.log('')
for (const row of rows) {
  console.log(row.map((cell, i) => String(cell ?? '—').padEnd(widths[i])).join('  '))
}
console.log(`\nrenderer: ${b?.renderer ?? a?.renderer ?? 'unknown'} (software — frame times are a ratio, not a benchmark)`)
console.log(`written to ${OUT_DIR}/avatar-cost.json`)

const allErrors = MODES.flatMap((mode) => (measured[mode]?.errors ?? []).map((error) => `${mode}: ${error}`))
if (allErrors.length > 0) {
  console.log('\nconsole errors:')
  for (const error of allErrors) console.log(`  ${error}`)
}

process.exit(failed ? 1 : 0)
