/**
 * Browser checks for the reception panel.
 *
 *   npm run build && npm run test:ui
 *
 * Deliberately short. Everything that can be checked without a browser already
 * is, in test-reception.mjs; what is left needs a real DOM — that the panel is
 * wired to the conversation, that the state chip moves, that the demo wording
 * survives the round trip to the screen, and that the controls are big enough
 * to hit on a phone.
 *
 * It runs in Standard View, which renders the same panel without a renderer.
 * That keeps the whole batch inside a minute on a machine with no GPU, where
 * anything that draws costs about 700 ms a frame.
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { preview } from 'vite'

const require = createRequire(import.meta.url)
const BUDGET_MS = Number(process.env.UI_TEST_TIMEOUT_MS ?? 120_000)

const checks = []
let failures = 0

function check(name, condition, detail = '') {
  if (!condition) failures += 1
  checks.push({ name, ok: Boolean(condition), detail })
}

/**
 * Every state the chip shows, caught rather than sampled.
 *
 * Polling `innerText` in a loop races the thing it is measuring: `processing`
 * lasts about 260 ms and the page is software-rendered at roughly 700 ms a
 * frame, so a poll can step straight over it and report a failure that says
 * nothing about the product. A MutationObserver sees every value the node ever
 * held, however briefly.
 */
const WATCH_CHIP = (selector) => {
  const node = document.querySelector(selector)
  const seen = [node.textContent.trim()]
  const record = () => {
    const text = node.textContent.trim()
    if (text && text !== seen[seen.length - 1]) seen.push(text)
  }
  new MutationObserver(record).observe(node, { childList: true, characterData: true, subtree: true })
  window.__chipStates = seen
}

function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    return require(`${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright`)
  }
}

if (!existsSync('dist/index.html')) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(2)
}

const watchdog = setTimeout(() => {
  console.error(`\nTIMED OUT after ${BUDGET_MS} ms; completed ${checks.length} check(s).`)
  process.exit(3)
}, BUDGET_MS)
watchdog.unref?.()

const { chromium } = loadPlaywright()
const server = await preview({ preview: { port: 4185, strictPort: true }, logLevel: 'error' })
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 2 })
const page = await context.newPage()

const consoleErrors = []
page.on('pageerror', (error) => consoleErrors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto('http://localhost:4185/lobby', { waitUntil: 'load', timeout: 25_000 })

  // Standard View renders the same panel with no renderer, so the batch stays
  // fast on a machine where every frame is software-rasterised.
  await page.getByRole('button', { name: 'Standard View', exact: true }).click()
  await page.getByRole('button', { name: 'Speak to our team' }).click()

  const chip = page.locator('.lobby-state-chip').first()
  await chip.waitFor({ timeout: 10_000 })
  check('the panel opens with a state chip', await chip.isVisible())

  // Deterministic rather than racy: if the character reported before the view
  // switched, this waits for the reset; if the reset never happens it fails
  // every time instead of one run in four. The bug it was written against was
  // exactly that — the panel kept describing a character that had unmounted.
  await page
    .waitForFunction(
      () => /no 3d character/i.test(document.querySelector('.lobby-capability')?.textContent ?? ''),
      null,
      { timeout: 8000 },
    )
    .catch(() => undefined)
  const capability = await page.locator('.lobby-capability').innerText()
  check(
    'Standard View says there is no character rather than describing one',
    /no 3d character/i.test(capability),
    capability,
  )

  // --- A typed question.
  await page.evaluate(WATCH_CHIP, '.lobby-state-chip')
  await page.getByPlaceholder('Type a question…').fill('What are your opening hours?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.waitForFunction(() => window.__chipStates.includes('Answering'), null, { timeout: 15_000 })
  const seen = await page.evaluate(() => window.__chipStates)
  check(
    'the chip reports thinking then answering',
    seen.includes('Thinking') && seen.includes('Answering'),
    seen.join(' -> '),
  )

  await page.waitForFunction(
    () => document.querySelectorAll('.lobby-turn-reception').length >= 2,
    null,
    { timeout: 10_000 },
  )
  const reply = await page.locator('.lobby-turn-reception').last().innerText()
  check('a reply reaches the transcript', /09:00/.test(reply), reply.slice(0, 80))

  // --- Asking for a person.
  await page.getByPlaceholder('Type a question…').fill('can I speak to a human')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.waitForFunction(
    () => /nobody is contacted/i.test(document.querySelector('.lobby-turn-reception:last-of-type')?.textContent ?? ''),
    null,
    { timeout: 10_000 },
  )
  const handover = await page.locator('.lobby-turn-reception').last().innerText()
  check('handover says nothing was sent', /nothing is sent/i.test(handover) && /nobody is contacted/i.test(handover), handover.slice(0, 90))
  check(
    'handover offers the enquiry journey',
    await page.getByRole('button', { name: 'Leave an enquiry' }).isVisible(),
  )

  // --- Voice controls exist, and the microphone has not been touched.
  const permissions = await page.evaluate(async () => {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' })
      return status.state
    } catch {
      return 'unqueryable'
    }
  })
  check('the microphone was never requested on load', permissions !== 'granted', permissions)
  const voiceRow = await page.locator('.lobby-voice-row').innerText()
  check('the panel states the voice position either way', voiceRow.length > 0, voiceRow.replace(/\n/g, ' | '))
  const toggle = page.locator('.lobby-toggle input')
  if (await toggle.count()) {
    check('replies are not read aloud until asked', !(await toggle.isChecked()))
  } else {
    check('speech output is reported unavailable rather than silently missing', /unavailable|no speech/i.test(voiceRow), voiceRow)
  }

  // --- Touch targets.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.lobby-service-centre button, .lobby-service-centre select, .lobby-service-centre textarea, .lobby-service-centre input:not([type="checkbox"]):not([type="radio"])')]
      .map((element) => ({
        text: (element.textContent || element.getAttribute('placeholder') || element.type || '').trim().slice(0, 24),
        box: element.getBoundingClientRect(),
      }))
      // A checkbox is excluded because the 44px label around it is the target;
      // everything else has to stand on its own.
      .filter((entry) => entry.box.height > 0 && entry.box.height < 44)
      .map((entry) => `${entry.text} ${Math.round(entry.box.height)}px`),
  )
  check('every control in the panel is at least 44px tall', small.length === 0, small.join(', '))

  // --- A booking receipt, announced by reception.
  await page.getByRole('button', { name: '← All services' }).click()
  await page.getByRole('button', { name: 'Book an appointment' }).click()
  await page.locator('select').first().waitFor({ timeout: 10_000 })
  const booked = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const set = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set
      setter.call(element, value)
      element.dispatchEvent(new Event('change', { bubbles: true }))
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const selects = [...document.querySelectorAll('.lobby-service-centre select')]
    for (const select of selects) {
      if (select.options.length > 1) set(select, select.options[1].value)
      await wait(400)
    }
    await wait(600)
    const slot = [...document.querySelectorAll('.lobby-service-centre button')].find((b) => /demo availability/.test(b.textContent ?? ''))
    slot?.click()
    await wait(400)
    for (const input of document.querySelectorAll('.lobby-service-centre input[type="text"], .lobby-service-centre input[type="email"]')) {
      set(input, input.type === 'email' ? 'visitor@example.com' : 'Test Visitor')
    }
    await wait(200)
    const submit = [...document.querySelectorAll('.lobby-service-centre button')].find((b) => /request|confirm|book/i.test(b.textContent ?? ''))
    submit?.click()
    await wait(1200)
    return document.querySelector('.lobby-service-centre')?.innerText ?? ''
  })
  check('a completed booking is labelled a demonstration', /demo|demonstration/i.test(booked), booked.slice(0, 120).replace(/\n/g, ' | '))

  await page.getByRole('button', { name: '← All services' }).click()
  await page.getByRole('button', { name: 'Speak to our team' }).click()
  const transcript = await page.locator('.lobby-transcript').innerText()
  check(
    'reception describes the receipt as a demonstration, not a booking',
    !/is (booked|confirmed|scheduled)/i.test(transcript),
    transcript.slice(-160).replace(/\n/g, ' | '),
  )

  // --- The same conversation, with the 3D character mounted.
  //
  // Everything above runs in Standard View, where there is no character at all.
  // This last pass is the one that proves the figure behind the counter and the
  // panel are the same exchange: the state chip over the 3D view is rendered
  // from the conversation, so watching it move is watching the wiring work.
  const scene = await context.newPage()
  const sceneErrors = []
  scene.on('pageerror', (error) => sceneErrors.push(String(error)))
  scene.on('console', (message) => {
    if (message.type() === 'error') sceneErrors.push(message.text())
  })
  await scene.setViewportSize({ width: 1000, height: 700 })
  await scene.goto('http://localhost:4185/lobby', { waitUntil: 'load', timeout: 25_000 })

  const hudChip = scene.locator('.lobby-hud-actions .lobby-state-chip')
  await hudChip.waitFor({ timeout: 20_000 })
  check('the 3D view shows the character state without opening anything', (await hudChip.innerText()).trim() === 'Waiting')

  // Talking to the character used to be three levels down — Reception services,
  // then Speak to our team, then Talk — which from the room meant there was no
  // way to talk to it at all.
  const hudButtons = await scene.locator('.lobby-hud-top button').allInnerTexts()
  check('Talk is in the 3D view itself', hudButtons.includes('Talk'), hudButtons.join(' | '))

  // And walking up to the counter has to be met with something. It used to be
  // met with silence: the greeting only fired when a panel was opened.
  await scene.evaluate(WATCH_CHIP, '.lobby-hud-actions .lobby-state-chip')
  await scene.getByRole('button', { name: 'Reception', exact: true }).click()
  await scene
    .waitForFunction(() => Boolean(document.querySelector('.lobby-caption')), null, { timeout: 20_000 })
    .catch(() => undefined)
  const caption = await scene.locator('.lobby-caption').innerText().catch(() => '')
  check(
    'walking up to reception is greeted, with the words on screen',
    /welcome to aicountly/i.test(caption),
    caption.replace(/\n/g, ' | ').slice(0, 90),
  )
  const greetedStates = await scene.evaluate(() => window.__chipStates)
  check('and the character plays its greeting', greetedStates.includes('Greeting you'), greetedStates.join(' -> '))

  await scene.evaluate(WATCH_CHIP, '.lobby-hud-actions .lobby-state-chip')
  await scene.getByRole('button', { name: 'Reception services' }).click()
  await scene.getByRole('button', { name: 'Speak to our team' }).click()
  await scene.getByPlaceholder('Type a question…').fill('What can Aicountly do?')
  await scene.getByRole('button', { name: 'Ask', exact: true }).click()

  await scene.waitForFunction(() => window.__chipStates.includes('Answering'), null, { timeout: 25_000 })
  const sceneStates = await scene.evaluate(() => window.__chipStates)
  check(
    'asking in the panel moves the character behind the counter',
    sceneStates.includes('Answering'),
    sceneStates.join(' -> '),
  )

  // And in 3D the panel must describe the character that is actually mounted,
  // read from a probe of it rather than from the manifest.
  const sceneCapability = await scene.locator('.lobby-capability').innerText()
  check(
    'the 3D panel reports the mounted character and its lip-sync mode',
    /procedural character/i.test(sceneCapability) &&
      /facial controls/i.test(sceneCapability) &&
      /scheduled from the reply text/i.test(sceneCapability),
    sceneCapability,
  )
  check('the 3D view logged no errors', sceneErrors.length === 0, sceneErrors.join(' | '))

  // --- The defect this section exists for.
  //
  // Talk was rendered 285 px below the fold of a scrolling panel, and a centred
  // modal covered the character completely. Both were reported as "there is no
  // Talk button and the character is not speaking", which is exactly what they
  // looked like. Neither is visible to a DOM assertion that only asks whether
  // an element exists, so these ask where it is.
  await scene.setViewportSize({ width: 414, height: 800 })
  await scene.waitForTimeout(800)
  const framing = await scene.evaluate(() => {
    const talk = [...document.querySelectorAll('button')].find((button) =>
      ['Talk', 'Stop listening'].includes(button.textContent.trim()),
    )
    const panel = document.querySelector('.lobby-modal')
    const t = talk?.getBoundingClientRect()
    const p = panel?.getBoundingClientRect()
    return {
      talkPresent: Boolean(talk),
      talkVisible: t ? t.top >= 0 && t.bottom <= window.innerHeight : false,
      talkTop: t ? Math.round(t.top) : null,
      panelTop: p ? Math.round(p.top) : null,
      viewport: window.innerHeight,
    }
  })
  check(
    'Talk is reachable without scrolling on a phone',
    framing.talkPresent && framing.talkVisible,
    `talk at ${framing.talkTop} of ${framing.viewport}`,
  )
  check(
    'the panel leaves the character visible above it',
    framing.panelTop !== null && framing.panelTop > framing.viewport * 0.3,
    `panel starts at ${framing.panelTop} of ${framing.viewport}`,
  )
} finally {
  clearTimeout(watchdog)
  await browser.close()
  await server.close()
}

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))

const width = Math.max(...checks.map((c) => c.name.length))
for (const entry of checks) {
  console.log(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name.padEnd(width)}${entry.detail ? `  ${entry.detail}` : ''}`)
}
console.log(`\n${checks.length - failures}/${checks.length} passed`)
process.exit(failures === 0 ? 0 : 1)
