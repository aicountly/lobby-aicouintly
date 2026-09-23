/**
 * Numeric tests for the reception character.
 *
 *   npm run test:reception
 *
 * The modules under test are the real ones, loaded through Vite's SSR module
 * graph, so TypeScript, path resolution and `import.meta.env` all behave as they
 * do in the browser. No renderer, no DOM and no Playwright: everything here is
 * state, arithmetic and geometry, and it runs in seconds rather than the tens of
 * minutes a software-rendered browser batch costs.
 *
 * What this cannot cover is what something *looks* like. Screenshots and the
 * frame-cost measurement are separate, in scripts/measure-avatar-cost.mjs.
 */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const results = []
let failures = 0

/**
 * A hang must fail fast.
 *
 * A test that never resolves is indistinguishable from a slow one until it has
 * already cost twenty minutes, so this run has a hard ceiling and reports what
 * it had finished when the ceiling was hit.
 */
const TIMEOUT_MS = Number(process.env.RECEPTION_TEST_TIMEOUT_MS ?? 60_000)
const watchdog = setTimeout(() => {
  console.error(`\nTIMED OUT after ${TIMEOUT_MS} ms. Completed ${results.length} test(s); last was "${results.at(-1)?.name ?? 'none'}".`)
  process.exit(3)
}, TIMEOUT_MS)
watchdog.unref?.()

function test(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    failures += 1
    results.push({ name, ok: false, error: error?.message ?? String(error) })
  }
}

async function asyncTest(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
  } catch (error) {
    failures += 1
    results.push({ name, ok: false, error: error?.message ?? String(error) })
  }
}

const server = await createServer({
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
})
const load = (path) => server.ssrLoadModule(path)

const states = await load('/src/lobby/reception/states.ts')
const visemes = await load('/src/lobby/reception/visemes.ts')
const expressions = await load('/src/lobby/reception/expressions.ts')
const capability = await load('/src/lobby/reception/capability.ts')
const turnGuard = await load('/src/lobby/reception/turnGuard.ts')
const signalModule = await load('/src/lobby/reception/signal.ts')
const lipSync = await load('/src/lobby/reception/lipSync.ts')
const animation = await load('/src/lobby/reception/animationController.ts')
const conversation = await load('/src/lobby/reception/conversation.ts')
const measure = await load('/src/lobby/reception/measure.ts')
const assetConfig = await load('/src/lobby/assets/assetConfig.ts')
const face = await load('/src/lobby/scene/face.ts')

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

test('all seven character states exist', () => {
  assert.equal(states.RECEPTIONIST_STATES.length, 7)
  assert.deepEqual([...states.RECEPTIONIST_STATES], [
    'idle', 'greeting', 'listening', 'processing', 'speaking', 'handover', 'error',
  ])
})

test('every state has a clip, an expression, a label and an announcement', () => {
  for (const state of states.RECEPTIONIST_STATES) {
    assert.ok(assetConfig.RECEPTIONIST_STATE_CLIPS[state], `clip for ${state}`)
    assert.ok(expressions.STATE_EXPRESSIONS[state], `expression for ${state}`)
    assert.ok(states.RECEPTION_STATE_LABELS[state], `label for ${state}`)
    assert.ok(states.RECEPTION_STATE_ANNOUNCEMENTS[state], `announcement for ${state}`)
    assert.ok(states.ALLOWED_TRANSITIONS[state], `transitions for ${state}`)
  }
})

test('every conversation phase maps to a character state', () => {
  const phases = ['idle', 'greeting', 'capturing', 'thinking', 'answering', 'handover', 'failed']
  const reached = new Set(phases.map((conversationPhase) =>
    states.characterStateFor({ conversation: conversationPhase, audio: 'silent' })))
  assert.deepEqual([...reached].sort(), ['answering', 'error', 'greeting', 'handover', 'idle', 'listening', 'processing']
    .map((p) => ({ answering: 'speaking', error: 'error', greeting: 'greeting', handover: 'handover', idle: 'idle', listening: 'listening', processing: 'processing' })[p]).sort())
})

test('audio outliving a turn still reads as speaking', () => {
  assert.equal(states.characterStateFor({ conversation: 'idle', audio: 'playing' }), 'speaking')
  assert.equal(states.characterStateFor({ conversation: 'idle', audio: 'silent' }), 'idle')
  // Capability is deliberately not an input: the caption must not disagree with
  // the figure just because the figure cannot play a clip.
  assert.equal(states.characterStateFor({ conversation: 'thinking', audio: 'playing' }), 'processing')
})

test('the transition table rejects an impossible move', () => {
  assert.equal(states.canTransition('idle', 'speaking'), true)
  assert.equal(states.canTransition('greeting', 'handover'), false)
  assert.equal(states.canTransition('error', 'idle'), true)
  assert.equal(states.canTransition('idle', 'idle'), true)
})

test('every state can reach idle and error', () => {
  for (const state of states.RECEPTIONIST_STATES) {
    if (state !== 'idle') assert.ok(states.canTransition(state, 'idle'), `${state} -> idle`)
    if (state !== 'error') assert.ok(states.canTransition(state, 'error'), `${state} -> error`)
  }
})

// ---------------------------------------------------------------------------
// Visemes
// ---------------------------------------------------------------------------

test('all fifteen OVR visemes map onto declared ARKit controls', () => {
  assert.equal(visemes.OVR_VISEMES.length, 15)
  const known = new Set(visemes.FACE_CONTROLS)
  for (const viseme of visemes.OVR_VISEMES) {
    const pose = visemes.VISEME_TO_ARKIT[viseme]
    assert.ok(pose, `mapping for ${viseme}`)
    for (const control of Object.keys(pose)) {
      assert.ok(known.has(control), `${viseme} uses unknown control ${control}`)
      assert.ok(pose[control] >= 0 && pose[control] <= 1, `${viseme}.${control} out of range`)
    }
  }
  assert.deepEqual(visemes.VISEME_TO_ARKIT.sil, {}, 'silence must move nothing')
})

test('a timeline is deterministic and ordered', () => {
  const a = visemes.visemeTimeline('Hello, and welcome to Aicountly.')
  const b = visemes.visemeTimeline('Hello, and welcome to Aicountly.')
  assert.deepEqual(a, b)
  assert.ok(a.length > 10)
  for (let i = 1; i < a.length; i += 1) {
    assert.ok(a[i].startMs >= a[i - 1].startMs, 'cues must not go backwards')
  }
})

test('"hello" opens, smiles, closes and rounds', () => {
  const cues = visemes.visemeTimeline('hello').filter((cue) => cue.viseme !== 'sil')
  // h -> aa (an open mouth), e -> E, ll -> nn (one shape, not two), o -> oh.
  assert.deepEqual(cues.map((cue) => cue.viseme), ['aa', 'E', 'nn', 'oh'])
})

test('a doubled consonant is one mouth shape', () => {
  const shapes = visemes.visemeTimeline('summer').filter((c) => c.viseme !== 'sil').map((c) => c.viseme)
  assert.equal(shapes.filter((s, i) => s === 'PP' && shapes[i - 1] === 'PP').length, 0)
})

test('a longer line takes longer to say', () => {
  const short = visemes.timelineDurationMs(visemes.visemeTimeline('Yes.'))
  const long = visemes.timelineDurationMs(visemes.visemeTimeline(
    'Booking is on the first card in this panel, and it stops before anything is written.'))
  assert.ok(long > short * 5, `${long} should be much longer than ${short}`)
})

test('visemeAt is silent before the start and blends inside a cue', () => {
  const timeline = visemes.visemeTimeline('welcome to reception')
  assert.equal(visemes.visemeAt(timeline, -50).viseme, 'sil')
  const mid = visemes.visemeAt(timeline, visemes.timelineDurationMs(timeline) / 2)
  assert.ok(visemes.OVR_VISEMES.includes(mid.viseme))
  assert.ok(mid.blend >= 0 && mid.blend <= 1)
  assert.equal(visemes.visemeAt(timeline, visemes.timelineDurationMs(timeline) + 500).viseme, 'sil')
})

test('the binary search agrees with a linear scan', () => {
  const timeline = visemes.visemeTimeline(
    'Aicountly is a family of business applications that share one sign-in, and this lobby is the front door to all of them.')
  for (let ms = 0; ms < visemes.timelineDurationMs(timeline); ms += 37) {
    let expected = timeline[0]
    for (const cue of timeline) if (cue.startMs <= ms) expected = cue
    assert.equal(visemes.visemeAt(timeline, ms).viseme, expected.viseme, `at ${ms}ms`)
  }
})

test('boundary corrections never rewind the mouth', () => {
  const timeline = visemes.visemeTimeline('one two three four five')
  const forward = visemes.retimedOffset(timeline, 8, 900, 0)
  assert.ok(forward >= 0)
  const backward = visemes.retimedOffset(timeline, 8, 10, forward)
  assert.equal(backward, forward, 'a late boundary must not pull the mouth back')
})

test('blendPose interpolates and visemePose scales', () => {
  const open = visemes.visemePose('aa')
  const half = visemes.visemePose('aa', 0.5)
  assert.ok(Math.abs(half.jawOpen - open.jawOpen / 2) < 1e-9)
  const blended = visemes.blendPose(visemes.visemePose('aa'), visemes.visemePose('PP'), 1)
  assert.ok(!blended.jawOpen, 'a full blend to PP leaves no jaw from aa')
  assert.ok(blended.mouthClose > 0.8)
})

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

test('expression poses only use declared controls and stay in range', () => {
  const known = new Set(visemes.FACE_CONTROLS)
  for (const [state, pose] of Object.entries(expressions.STATE_EXPRESSIONS)) {
    for (const [control, value] of Object.entries(pose)) {
      assert.ok(known.has(control), `${state} uses unknown control ${control}`)
      assert.ok(value >= 0 && value <= 1, `${state}.${control} out of range`)
    }
  }
})

test('approachPose converges and never overshoots', () => {
  const current = expressions.emptyPose()
  const target = { jawOpen: 1 }
  for (let i = 0; i < 200; i += 1) expressions.approachPose(current, target, 3.2, 1 / 60)
  assert.equal(current.jawOpen, 1)
  expressions.approachPose(current, target, 3.2, 1 / 60)
  assert.equal(current.jawOpen, 1, 'must not overshoot once arrived')
})

test('addPose clamps rather than renormalising', () => {
  const sum = expressions.addPose({ mouthSmileLeft: 0.8 }, { mouthSmileLeft: 0.7 })
  assert.equal(sum.mouthSmileLeft, 1)
})

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

test('a face with only a jaw cannot shape visemes', () => {
  const jawOnly = capability.faceCapabilityFrom(['jawOpen'])
  assert.equal(jawOnly.canOpenJaw, true)
  assert.equal(jawOnly.canShapeMouth, false)
  assert.equal(jawOnly.canBlink, false)
})

test('a face with the shaping set can', () => {
  const full = capability.faceCapabilityFrom([
    'jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'eyeBlinkLeft',
  ])
  assert.equal(full.canShapeMouth, true)
  assert.equal(full.canBlink, true)
})

test('native viseme shapes are recognised under both spellings', () => {
  const native = capability.faceCapabilityFrom(visemes.OVR_VISEMES.map((v) => `viseme_${v}`))
  assert.equal(native.nativeVisemes.length, 15)
  assert.equal(native.canShapeMouth, true)
  const bare = capability.faceCapabilityFrom(visemes.OVR_VISEMES)
  assert.equal(bare.nativeVisemes.length, 15)
})

test('lip-sync mode is chosen by how much it actually knows about the sound', () => {
  const shaped = capability.faceCapabilityFrom(['jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft'])
  const jawOnly = capability.faceCapabilityFrom(['jawOpen'])
  const none = capability.faceCapabilityFrom([])
  const pick = (face, sources) => capability.chooseLipSyncMode(face, { visemeEvents: false, analyser: false, text: false, ...sources })

  assert.equal(pick(shaped, { visemeEvents: true, analyser: true, text: true }), 'provider-viseme')
  assert.equal(pick(shaped, { analyser: true, text: true }), 'audio-reactive')
  assert.equal(pick(shaped, { text: true }), 'text-estimated')
  assert.equal(pick(jawOnly, { analyser: true, text: true }), 'audio-reactive')
  assert.equal(pick(jawOnly, { text: true }), 'none', 'a jaw alone cannot form shapes from text')
  assert.equal(pick(none, { visemeEvents: true, analyser: true, text: true }), 'none')
})

test('no mode claims to be provider-timed unless a provider timed it', () => {
  // The old name for text-estimated was "timed", which read as though the
  // speech provider had supplied the timings. Nothing may describe it that way.
  const described = capability.describeLipSyncMode('text-estimated')
  assert.ok(/estimated/i.test(described), described)
  assert.ok(/nothing measures the audio/i.test(described), described)
  assert.ok(!/provider/i.test(described), 'text-estimated must not mention a provider')
  assert.ok(/not phoneme-accurate/i.test(capability.describeLipSyncMode('audio-reactive')))
})

/** A duck-typed stand-in for a loaded glTF scene. */
function fakeGltf({ clips = [], morphNames = null, unnamedMorphs = 0, bones = 0 }) {
  const nodes = []
  for (let i = 0; i < bones; i += 1) nodes.push({ isBone: true })
  nodes.push({
    isMesh: true,
    isSkinnedMesh: true,
    morphTargetDictionary: morphNames
      ? Object.fromEntries(morphNames.map((name, index) => [name, index]))
      : undefined,
    geometry: { morphAttributes: { position: new Array(unnamedMorphs).fill(null) } },
  })
  return {
    traverse(callback) {
      for (const node of nodes) callback(node)
    },
    clips: clips.map((name) => ({ name, duration: 1.5 })),
  }
}

test('a glTF probe reads clips and morph names, not the manifest', () => {
  const model = fakeGltf({
    clips: ['Idle_Loop', 'Wave_01'],
    morphNames: ['jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'eyeBlinkLeft'],
    bones: 43,
  })
  const probed = capability.describeGltfCharacter(model, model.clips, { idle: 'Idle_Loop', greet: 'Wave_01' })
  assert.equal(probed.source, 'gltf')
  assert.equal(probed.skinned, true)
  assert.equal(probed.bones, 43)
  assert.equal(probed.clipsByRole.idle, 'Idle_Loop')
  assert.equal(probed.clipsByRole.greet, 'Wave_01')
  // The manifest claims nothing about `speak`, and the file has nothing either,
  // so it falls back rather than inventing a clip name.
  assert.equal(probed.clipsByRole.speak, 'Idle_Loop')
  assert.deepEqual([...probed.rolesProvided], ['idle', 'greet'])
  assert.equal(probed.face.canShapeMouth, true)
})

test('a manifest claiming a clip the file lacks does not get it', () => {
  const model = fakeGltf({ clips: ['Idle'], morphNames: [] })
  const probed = capability.describeGltfCharacter(model, model.clips, {
    idle: 'Idle', speak: 'Speak_That_Does_Not_Exist',
  })
  assert.equal(probed.clipsByRole.speak, 'Idle')
  assert.ok(!probed.rolesProvided.includes('speak'))
})

test('unnamed morph targets are reported and never guessed at', () => {
  const model = fakeGltf({ clips: ['Idle'], morphNames: null, unnamedMorphs: 52 })
  const probed = capability.describeGltfCharacter(model, model.clips, { idle: 'Idle' })
  assert.equal(probed.face.controls.length, 0)
  assert.ok(probed.notes.some((note) => note.includes('extras.targetNames')))
})

test('morph targets with names nobody recognises are reported, not driven', () => {
  const model = fakeGltf({ clips: ['Idle'], morphNames: ['Key1', 'Key2', 'Shape_07'] })
  const probed = capability.describeGltfCharacter(model, model.clips, { idle: 'Idle' })
  assert.equal(probed.face.controls.length, 0)
  assert.ok(probed.notes.some((note) => note.includes('ARKit')))
})

test('the clip fallback chain terminates', () => {
  for (const role of assetConfig.RECEPTIONIST_CLIPS) {
    const chain = assetConfig.CLIP_FALLBACK[role]
    assert.ok(Array.isArray(chain), `${role} has a chain`)
    if (role !== 'idle') assert.ok(chain.includes('idle'), `${role} must end at idle`)
  }
})

// ---------------------------------------------------------------------------
// Turn guard
// ---------------------------------------------------------------------------

test('a new turn cancels the previous one', () => {
  const guard = turnGuard.createTurnGuard()
  const first = guard.begin()
  assert.equal(first.isCurrent(), true)
  const second = guard.begin()
  assert.equal(first.cancelled, true)
  assert.equal(first.signal.aborted, true)
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
})

test('cleanup runs once, in reverse order, on cancel and on settle', () => {
  const guard = turnGuard.createTurnGuard()
  const order = []
  const token = guard.begin()
  token.onRelease(() => order.push('outer'))
  token.onRelease(() => order.push('inner'))
  guard.cancel()
  assert.deepEqual(order, ['inner', 'outer'])
  guard.cancel()
  assert.deepEqual(order, ['inner', 'outer'], 'cancelling twice must not re-run cleanup')

  const settled = guard.begin()
  const ran = []
  settled.onRelease(() => ran.push(1))
  settled.settle()
  assert.deepEqual(ran, [1])
  assert.equal(settled.cancelled, false)
})

test('cleanup registered after the turn closed runs immediately', () => {
  const guard = turnGuard.createTurnGuard()
  const token = guard.begin()
  token.settle()
  let ran = false
  token.onRelease(() => {
    ran = true
  })
  assert.equal(ran, true)
})

test('one failing cleanup does not stop the others', () => {
  const guard = turnGuard.createTurnGuard()
  const token = guard.begin()
  const ran = []
  token.onRelease(() => ran.push('first'))
  token.onRelease(() => {
    throw new Error('speech cancel blew up')
  })
  token.onRelease(() => ran.push('last'))
  guard.cancel()
  assert.deepEqual(ran, ['last', 'first'])
})

test('a disposed guard refuses new turns', () => {
  const guard = turnGuard.createTurnGuard()
  guard.begin()
  guard.dispose()
  assert.throws(() => guard.begin())
})

// ---------------------------------------------------------------------------
// Animation controller
// ---------------------------------------------------------------------------

function fullCapability() {
  return capability.proceduralCapability(capability.faceCapabilityFrom([
    'jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'eyeBlinkLeft',
  ]))
}

test('the controller starts in idle', () => {
  const controller = animation.createReceptionAnimationController({ capability: fullCapability() })
  assert.equal(controller.role, 'idle')
  assert.equal(controller.blend, 1)
  controller.dispose()
})

test('each state selects its own role', () => {
  const controller = animation.createReceptionAnimationController({ capability: fullCapability() })
  for (const state of states.RECEPTIONIST_STATES) {
    controller.setState(state)
    assert.equal(controller.role, assetConfig.RECEPTIONIST_STATE_CLIPS[state], `role for ${state}`)
    controller.setState('idle')
  }
  controller.dispose()
})

test('a crossfade runs from 0 to 1 and then drops the old role', () => {
  const controller = animation.createReceptionAnimationController({
    capability: fullCapability(),
    crossFadeSeconds: 0.3,
  })
  controller.setState('listening')
  assert.equal(controller.blend, 0)
  assert.equal(controller.previousRole, 'idle')
  controller.update(0.15)
  assert.ok(controller.blend > 0.4 && controller.blend < 0.6, `blend was ${controller.blend}`)
  controller.update(0.2)
  assert.equal(controller.blend, 1)
  assert.equal(controller.previousRole, null)
  controller.dispose()
})

test('greeting plays once and hands back', () => {
  const ended = []
  const controller = animation.createReceptionAnimationController({
    capability: fullCapability(),
    onOneShotEnd: (state) => ended.push(state),
  })
  controller.setState('greeting')
  assert.equal(controller.oneShotActive, true)
  for (let i = 0; i < 40; i += 1) controller.update(1 / 20)
  assert.deepEqual(ended, ['greeting'])
  assert.equal(controller.role, 'idle')
  assert.equal(controller.oneShotActive, false)
  controller.dispose()
})

test('listening loops rather than ending', () => {
  const ended = []
  const controller = animation.createReceptionAnimationController({
    capability: fullCapability(),
    onOneShotEnd: (state) => ended.push(state),
  })
  controller.setState('listening')
  for (let i = 0; i < 100; i += 1) controller.update(1 / 20)
  assert.deepEqual(ended, [])
  assert.equal(controller.role, 'listen')
  controller.dispose()
})

test('a huge frame gap neither skips a one-shot nor fires it twice', () => {
  const ended = []
  const controller = animation.createReceptionAnimationController({
    capability: fullCapability(),
    onOneShotEnd: (state) => ended.push(state),
  })
  controller.setState('greeting')
  // A backgrounded tab hands back one enormous delta on return. The clamp means
  // one frame cannot consume the whole gesture, so the visitor sees the wave
  // rather than its last frame.
  controller.update(60)
  assert.deepEqual(ended, [], 'one frame must not swallow the gesture')
  assert.equal(controller.role, 'greet')
  for (let i = 0; i < 40; i += 1) controller.update(1 / 20)
  assert.deepEqual(ended, ['greeting'], 'and it still finishes, exactly once')
  assert.equal(controller.role, 'idle')
  controller.dispose()
})

test('reduced motion removes the crossfade but keeps the pose change', () => {
  const controller = animation.createReceptionAnimationController({
    capability: fullCapability(),
    reducedMotion: true,
  })
  controller.setState('speaking')
  assert.equal(controller.role, 'speak')
  assert.equal(controller.blend, 1)
  controller.dispose()
})

test('a character with only an idle clip still changes state safely', () => {
  const model = fakeGltf({ clips: ['Idle'], morphNames: [] })
  const probed = capability.describeGltfCharacter(model, model.clips, { idle: 'Idle' })
  const controller = animation.createReceptionAnimationController({ capability: probed })
  controller.setState('greeting')
  assert.equal(controller.role, 'greet')
  assert.equal(probed.clipsByRole.greet, 'Idle', 'the role falls back to the only clip there is')
  controller.dispose()
})

// ---------------------------------------------------------------------------
// Lip sync
// ---------------------------------------------------------------------------

test('a text-estimated schedule produces a moving mouth across the line', () => {
  const sig = signalModule.createReceptionSignal()
  sig.lipSync = 'text-estimated'
  const timeline = visemes.visemeTimeline('Welcome to Aicountly reception.')
  signalModule.beginSpeaking(sig, timeline, 1000)
  assert.deepEqual(lipSync.sampleLipSync(sig, 900), {}, 'silent before the start')

  const shapes = new Set()
  let movedFrames = 0
  const total = visemes.timelineDurationMs(timeline)
  for (let ms = 0; ms < total; ms += 16) {
    const pose = lipSync.sampleLipSync(sig, 1000 + ms)
    const keys = Object.keys(pose)
    if (keys.length > 0) movedFrames += 1
    for (const key of keys) shapes.add(key)
  }
  assert.ok(movedFrames > total / 16 * 0.6, `mouth moved on ${movedFrames} frames`)
  assert.ok(shapes.size >= 4, `only ${shapes.size} distinct controls used`)
  assert.ok(shapes.has('jawOpen'))
})

test('a schedule stops when speaking stops', () => {
  const sig = signalModule.createReceptionSignal()
  sig.lipSync = 'text-estimated'
  signalModule.beginSpeaking(sig, visemes.visemeTimeline('hello there'), 0)
  assert.ok(Object.keys(lipSync.sampleLipSync(sig, 120)).length > 0)
  signalModule.endSpeaking(sig)
  assert.deepEqual(lipSync.sampleLipSync(sig, 120), {})
  assert.equal(sig.speaking, false)
})

test('audio-reactive drives the jaw from the envelope and nothing else', () => {
  const sig = signalModule.createReceptionSignal()
  sig.lipSync = 'audio-reactive'
  sig.speaking = true
  let level = 0
  sig.envelope = () => level

  assert.deepEqual(lipSync.sampleLipSync(sig, 0), {}, 'silence moves nothing')
  level = 0.5
  const half = lipSync.sampleLipSync(sig, 0)
  level = 1
  const full = lipSync.sampleLipSync(sig, 0)
  assert.ok(full.jawOpen > half.jawOpen)
  assert.ok(full.jawOpen <= 0.8)
  // An envelope says how loud, never which sound, so it must not claim a shape.
  assert.deepEqual(Object.keys(full).sort(), ['jawOpen', 'mouthFunnel'])
})

test('no mouth controls means nothing moves at all', () => {
  const sig = signalModule.createReceptionSignal()
  sig.lipSync = 'none'
  signalModule.beginSpeaking(sig, visemes.visemeTimeline('hello'), 0)
  assert.deepEqual(lipSync.sampleLipSync(sig, 100), {})
})

test('the analyser envelope rises fast and falls slow', () => {
  const analyser = {
    fftSize: 64,
    level: 0,
    getByteTimeDomainData(array) {
      for (let i = 0; i < array.length; i += 1) {
        array[i] = 128 + Math.round(this.level * 127 * (i % 2 === 0 ? 1 : -1))
      }
    },
  }
  const read = lipSync.createAnalyserEnvelope(analyser)
  analyser.level = 0.4
  let rising = 0
  for (let i = 0; i < 6; i += 1) rising = read()
  assert.ok(rising > 0.5, `envelope reached ${rising}`)
  analyser.level = 0
  const afterOneFrame = read()
  assert.ok(afterOneFrame > rising * 0.5, 'release must be slower than attack')
})

test('native viseme weights are emitted under both spellings and sum to one', () => {
  const sig = signalModule.createReceptionSignal()
  sig.lipSync = 'text-estimated'
  const timeline = visemes.visemeTimeline('welcome')
  signalModule.beginSpeaking(sig, timeline, 0)
  const weights = lipSync.sampleNativeVisemes(sig, 40)
  const keys = Object.keys(weights)
  assert.ok(keys.some((key) => key.startsWith('viseme_')))
  assert.ok(keys.some((key) => !key.startsWith('viseme_')))
  const prefixed = keys.filter((key) => key.startsWith('viseme_'))
  const total = prefixed.reduce((sum, key) => sum + weights[key], 0)
  assert.ok(Math.abs(total - 1) < 0.01, `weights summed to ${total}`)
})

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/** A clock and a timer queue the test drives by hand. */
function fakeClock() {
  let time = 0
  let nextId = 1
  const timers = new Map()
  return {
    now: () => time,
    setTimer(fn, ms) {
      const id = nextId++
      timers.set(id, { at: time + ms, fn })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    advance(ms) {
      time += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id)
          timer.fn()
        }
      }
    },
    pending: () => timers.size,
  }
}

function fakeAdapter(reply) {
  const calls = []
  let resolve = null
  return {
    calls,
    mode: 'demo',
    description: 'test',
    async listServices() { return { status: 'ok', mode: 'demo', data: [] } },
    async listAvailability() { return { status: 'ok', mode: 'demo', data: [] } },
    async requestBooking() { return { status: 'ok', mode: 'demo', data: {} } },
    async submitEnquiry() { return { status: 'ok', mode: 'demo', data: {} } },
    askReception(question) {
      calls.push(question)
      if (typeof reply === 'function') return reply(question)
      return Promise.resolve(reply)
    },
    hold() {
      return new Promise((r) => {
        resolve = r
      })
    },
    release(value) {
      resolve?.(value)
    },
  }
}

const OK_REPLY = {
  status: 'ok',
  mode: 'demo',
  data: { text: 'We are open nine until half past five.', demo: true, suggestions: ['Where are you?'] },
}

function newConversation(adapter, extra = {}) {
  const clock = fakeClock()
  const sig = signalModule.createReceptionSignal()
  const convo = conversation.createReceptionConversation({
    adapter,
    signal: sig,
    capability: fullCapability(),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...extra,
  })
  return { convo, sig, clock }
}

await asyncTest('the greeting is spoken, not just posed', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo, sig, clock } = newConversation(adapter)
  assert.equal(convo.snapshot().turns.length, 0, 'nothing is said before anyone is greeted')

  convo.greet()
  const snapshot = convo.snapshot()
  assert.equal(sig.state, 'greeting')
  assert.equal(snapshot.turns.length, 1)
  assert.equal(snapshot.turns[0].role, 'reception')
  // The mouth has to move. A character that waves with a closed mouth while its
  // line sits in a transcript is not greeting anybody.
  assert.equal(sig.speaking, true)
  assert.ok(sig.timeline.length > 10, `greeting scheduled ${sig.timeline.length} mouth shapes`)

  clock.advance(60_000)
  assert.equal(sig.state, 'idle')
  assert.equal(sig.speaking, false)
  convo.dispose()
})

await asyncTest('greeting is silent unless the visitor turned speech on', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const speaker = fakeVoiceOutput()
  const { convo } = newConversation(adapter, { voiceOutput: speaker })
  convo.greet()
  assert.deepEqual(speaker.state.spoken, [], 'walking in must not be met with a page that talks at you')
  convo.dispose()
})

await asyncTest('greeting happens once, and again only on a return visit', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo, sig, clock } = newConversation(adapter)
  convo.greet()
  convo.greet()
  assert.equal(convo.snapshot().turns.length, 1, 'a second approach mid-greeting must not re-greet')

  convo.greet(true)
  assert.equal(convo.snapshot().turns.length, 1, 'nor must a forced greeting interrupt one in progress')

  clock.advance(60_000)
  assert.equal(sig.state, 'idle')
  convo.greet(true)
  assert.equal(convo.snapshot().turns.length, 2, 'coming back later is greeted again')
  convo.dispose()
})

await asyncTest('a question during the greeting wins', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo, sig } = newConversation(adapter)
  convo.greet()
  assert.equal(sig.state, 'greeting')
  await convo.ask('what are your opening hours')
  assert.equal(sig.state, 'speaking')
  const texts = convo.snapshot().turns.map((turn) => turn.text)
  assert.equal(texts.at(-1), OK_REPLY.data.text)
  convo.dispose()
})

await asyncTest('a question runs thinking then speaking then idle', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo, sig, clock } = newConversation(adapter)
  const asking = convo.ask('What are your opening hours?')
  assert.equal(convo.snapshot().phase, 'thinking')
  assert.equal(sig.state, 'processing')
  await asking
  assert.equal(convo.snapshot().phase, 'answering')
  assert.equal(sig.state, 'speaking')
  assert.equal(sig.speaking, true)
  assert.ok(sig.timeline.length > 0, 'a schedule of mouth shapes was built')
  clock.advance(60_000)
  assert.equal(convo.snapshot().phase, 'idle')
  assert.equal(sig.state, 'idle')
  assert.equal(sig.speaking, false)
  const turns = convo.snapshot().turns
  assert.equal(turns[turns.length - 1].text, OK_REPLY.data.text)
  convo.dispose()
})

await asyncTest('a superseded reply is dropped', async () => {
  // Both calls are held, then both released: resolving only the second would
  // leave the first `await` hanging, which is a bug in the test, not the code.
  const pending = []
  const adapter = fakeAdapter(() => new Promise((resolve) => pending.push(resolve)))
  const { convo, sig } = newConversation(adapter)
  const first = convo.ask('first question')
  const second = convo.ask('second question')
  assert.equal(pending.length, 2)
  for (const resolve of pending) resolve(OK_REPLY)
  await first
  await second
  const texts = convo.snapshot().turns.map((turn) => turn.text)
  assert.equal(texts.filter((text) => text === OK_REPLY.data.text).length, 1,
    'only the current turn may reach the transcript')
  assert.ok(sig.state === 'speaking' || sig.state === 'idle')
  convo.dispose()
})

await asyncTest('an unavailable integration is reported, never faked', async () => {
  const adapter = fakeAdapter({
    status: 'unavailable',
    integration: 'Aicountly Appointments',
    reason: 'The booking API base URL is not configured.',
  })
  const { convo, sig } = newConversation(adapter)
  await convo.ask('can I book something')
  const snapshot = convo.snapshot()
  assert.equal(snapshot.phase, 'failed')
  assert.equal(sig.state, 'error')
  assert.ok(snapshot.unavailable)
  assert.equal(snapshot.unavailable.integration, 'Aicountly Appointments')
  const last = snapshot.turns[snapshot.turns.length - 1].text
  assert.ok(last.includes('Aicountly Appointments'))
  assert.deepEqual(conversation.bookingClaimsIn(last), [], 'a failure must claim nothing')
  convo.dispose()
})

await asyncTest('an adapter that throws does not leave the character mid-sentence', async () => {
  const adapter = fakeAdapter(() => Promise.reject(new Error('network')))
  const { convo, sig, clock } = newConversation(adapter)
  await convo.ask('hello')
  assert.equal(sig.state, 'error')
  clock.advance(60_000)
  assert.equal(sig.state, 'idle')
  assert.equal(sig.speaking, false)
  convo.dispose()
})

await asyncTest('asking for a person hands over without contacting anybody', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo, sig } = newConversation(adapter)
  await convo.ask('can I speak to a human please')
  assert.equal(sig.state, 'handover')
  assert.equal(adapter.calls.length, 0, 'handover is decided locally, not by the adapter')
  const last = convo.snapshot().turns.at(-1).text
  assert.deepEqual(conversation.bookingClaimsIn(last), [])
  assert.ok(/nobody is contacted|nothing is sent/i.test(last))
  assert.equal(convo.snapshot().shortcut.key, 'enquiry')
  convo.dispose()
})

test('service shortcuts point at the right journey', () => {
  assert.equal(conversation.detectShortcut('I want to book an appointment').key, 'booking')
  assert.equal(conversation.detectShortcut('how much does it cost').key, 'enquiry')
  assert.equal(conversation.detectShortcut('the weather today'), null)
  assert.equal(conversation.wantsHandover('put me through to someone'), true)
  assert.equal(conversation.wantsHandover('what are your opening hours'), false)
})

test('a demo receipt is never described as a real booking', () => {
  const demo = conversation.describeReceipt({
    reference: 'APT-DEMO-X1', serviceLabel: 'Discovery call', date: '2026-10-01', time: '09:00',
    demo: true, note: '',
  })
  assert.deepEqual(conversation.bookingClaimsIn(demo), [], demo)
  assert.ok(/demonstration/i.test(demo))
  assert.ok(/no appointment exists/i.test(demo))
  assert.ok(demo.includes('APT-DEMO-X1'))

  const demoEnquiry = conversation.describeReceipt({ reference: 'ENQ-DEMO-1', demo: true, note: '' })
  assert.deepEqual(conversation.bookingClaimsIn(demoEnquiry), [], demoEnquiry)
  assert.ok(/nothing was sent/i.test(demoEnquiry))

  // The same function must still be able to state a real one, or it would be
  // unusable the moment a live adapter appears.
  const live = conversation.describeReceipt({
    reference: 'APT-9', serviceLabel: 'Discovery call', date: '2026-10-01', time: '09:00',
    demo: false, note: '',
  })
  assert.ok(conversation.bookingClaimsIn(live).length > 0, 'a real receipt is allowed to be affirmative')
})

await asyncTest('announcing a demo receipt keeps the demo wording', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo } = newConversation(adapter)
  convo.announceReceipt({
    reference: 'APT-DEMO-77', serviceLabel: 'Onboarding session', date: '2026-10-02', time: '11:15',
    demo: true, note: '',
  })
  const last = convo.snapshot().turns.at(-1).text
  assert.deepEqual(conversation.bookingClaimsIn(last), [], last)
  assert.ok(last.includes('APT-DEMO-77'))
  convo.dispose()
})

await asyncTest('interrupting stops the mouth, the clock and the turn', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo, sig, clock } = newConversation(adapter)
  await convo.ask('hello')
  assert.equal(sig.speaking, true)
  assert.ok(clock.pending() > 0)
  convo.interrupt()
  assert.equal(sig.speaking, false)
  assert.equal(sig.state, 'idle')
  assert.equal(clock.pending(), 0, 'the pending finish timer was cleared')
  convo.dispose()
})

await asyncTest('reduced motion drops to captions without dropping the reply', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const { convo, sig } = newConversation(adapter, { reducedMotion: true })
  await convo.ask('hello')
  assert.equal(sig.lipSync, 'none')
  assert.equal(sig.timeline.length, 0)
  assert.equal(convo.snapshot().turns.at(-1).text, OK_REPLY.data.text)
  convo.dispose()
})

// --- Voice, with a fake engine.

function fakeVoiceInput() {
  const state = { started: 0, stopped: 0, events: null, tracksOpen: false }
  return {
    state,
    get listening() {
      return state.tracksOpen
    },
    async start(events) {
      state.started += 1
      state.events = events
      state.tracksOpen = true
      return true
    },
    stop() {
      state.stopped += 1
      state.tracksOpen = false
    },
  }
}

function fakeVoiceOutput() {
  const state = { spoken: [], cancelled: 0, handlers: null }
  return {
    state,
    get speaking() {
      return false
    },
    speak(text, handlers) {
      state.spoken.push(text)
      state.handlers = handlers
      return true
    },
    cancel() {
      state.cancelled += 1
    },
  }
}

await asyncTest('the microphone opens only on Talk and closes on every exit', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const voice = fakeVoiceInput()
  const { convo, sig } = newConversation(adapter, { voiceInput: voice })
  assert.equal(voice.state.started, 0, 'nothing may open the microphone before Talk')

  await convo.startVoice()
  assert.equal(voice.state.started, 1)
  assert.equal(voice.state.tracksOpen, true)
  assert.equal(sig.state, 'listening')
  assert.equal(convo.snapshot().voice.listening, true)

  convo.stopVoice()
  assert.equal(voice.state.stopped >= 1, true)
  assert.equal(voice.state.tracksOpen, false)
  assert.equal(sig.state, 'idle')
  convo.dispose()
})

await asyncTest('a captured phrase becomes a question and releases the microphone', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const voice = fakeVoiceInput()
  const { convo, sig } = newConversation(adapter, { voiceInput: voice })
  await convo.startVoice()
  voice.state.events.onPartial('what are your')
  assert.equal(convo.snapshot().heard, 'what are your')
  voice.state.events.onFinal('what are your opening hours')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(adapter.calls[0], 'what are your opening hours')
  assert.equal(voice.state.tracksOpen, false, 'the microphone must not stay open through the reply')
  assert.ok(['speaking', 'processing'].includes(sig.state))
  convo.dispose()
})

await asyncTest('disposing closes the microphone and the speaker', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const voice = fakeVoiceInput()
  const speaker = fakeVoiceOutput()
  const { convo } = newConversation(adapter, { voiceInput: voice, voiceOutput: speaker })
  await convo.startVoice()
  convo.dispose()
  assert.equal(voice.state.tracksOpen, false)
  assert.ok(speaker.state.cancelled >= 1)
})

await asyncTest('replies are only spoken when the visitor asked for it', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const speaker = fakeVoiceOutput()
  const { convo, clock } = newConversation(adapter, { voiceOutput: speaker })
  await convo.ask('hello')
  assert.deepEqual(speaker.state.spoken, [], 'speech must not autoplay')
  clock.advance(60_000)

  convo.setVoiceOutput(true)
  await convo.ask('hello again')
  assert.equal(speaker.state.spoken.length, 1)
  convo.dispose()
})

await asyncTest('pressing Talk makes it answer aloud', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const voice = fakeVoiceInput()
  const speaker = fakeVoiceOutput()
  const { convo } = newConversation(adapter, { voiceInput: voice, voiceOutput: speaker })
  assert.equal(convo.snapshot().voice.outputEnabled, false, 'silent until something asks for sound')

  await convo.startVoice()
  assert.equal(convo.snapshot().voice.outputEnabled, true, 'a spoken question expects a spoken answer')

  voice.state.events.onFinal('what are your opening hours')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(speaker.state.spoken.length, 1, speaker.state.spoken.join(' | '))
  convo.dispose()
})

await asyncTest('typing still does not turn the sound on', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const speaker = fakeVoiceOutput()
  const { convo } = newConversation(adapter, { voiceOutput: speaker })
  await convo.ask('what are your opening hours')
  assert.equal(convo.snapshot().voice.outputEnabled, false)
  assert.deepEqual(speaker.state.spoken, [])
  convo.dispose()
})

await asyncTest('the mouth stays closed until the voice actually starts', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const speaker = fakeVoiceOutput()
  const { convo, sig } = newConversation(adapter, { voiceOutput: speaker })
  convo.setVoiceOutput(true)
  await convo.ask('hello')

  // speechSynthesis.speak() has returned, but no sound has come out yet: the
  // engine still has to pick a voice and warm up, which on a real browser is
  // hundreds of milliseconds and sometimes more than a second. Animating here
  // is what made the lips lead the voice for a whole reply.
  assert.equal(speaker.state.spoken.length, 1, 'the line was handed to the engine')
  assert.equal(sig.speaking, false, 'but nothing is being said yet, so the mouth is still')
  assert.deepEqual(sig.timeline, [], 'and no schedule is running')

  speaker.state.handlers.onStart()
  assert.equal(sig.speaking, true, 'the schedule starts when the voice does')
  assert.ok(sig.timeline.length > 0, 'and it has cues to play')

  convo.dispose()
})

await asyncTest('the journey offered comes from what reception proposed', async () => {
  const { shortcutForReply } = conversation

  // The backend validates every action against an allowlist and drops any
  // whose journey the business switched off. Using its answer is what makes
  // that gating mean anything to a visitor.
  assert.equal(
    shortcutForReply([{ name: 'request_handover' }], 'what are your opening hours')?.key,
    'handover',
    'the proposed action wins over the words the visitor used',
  )
  assert.equal(shortcutForReply([{ name: 'offer_booking' }], 'hello')?.key, 'booking')
  assert.equal(shortcutForReply([{ name: 'offer_enquiry' }], 'hello')?.key, 'enquiry')

  // An action the allowlist does not know is not a journey.
  assert.equal(shortcutForReply([{ name: 'transfer_funds' }], 'hello'), null)

  // No action proposed falls back to the keyword match, which is what the
  // demonstration adapter relies on — it has no actions to propose.
  assert.equal(shortcutForReply([], 'I would like to book an appointment')?.key, 'booking')
  assert.equal(shortcutForReply(undefined, 'can I speak to a person')?.key, 'handover')
})

await asyncTest('asking for a person does not open the question panel', async () => {
  // The regression this ordering exists to prevent: "speak to" contains no
  // handover keyword under the old patterns, but "ask"/"help" match 'team',
  // so asking for a human opened another text box.
  const { detectShortcut } = conversation

  for (const question of [
    'can I speak to a person',
    'I want to talk to someone',
    'is there a real person there',
    'can I ask a human for help',
  ]) {
    assert.equal(detectShortcut(question)?.key, 'handover', `"${question}" must reach the queue`)
  }

  // And a plain question still does not.
  assert.equal(detectShortcut('I have a question about parking')?.key, 'team')
})

await asyncTest('the lip-sync lead is measured, not assumed', async () => {
  // Evidence rather than a boolean. The Phase 2E report said the mouth led the
  // voice; this puts a number on what the fix is worth, on a controlled clock,
  // so a regression shows as a figure moving rather than as somebody noticing
  // on a deployed site.
  const adapter = fakeAdapter(OK_REPLY)
  const speaker = fakeVoiceOutput()
  const { convo, sig, clock } = newConversation(adapter, { voiceOutput: speaker })
  convo.setVoiceOutput(true)
  await convo.ask('hello')

  const issuedAt = clock.now()
  assert.equal(sig.speaking, false, 'nothing may animate during the warm-up')

  // A realistic speechSynthesis warm-up: Chrome commonly takes this long to
  // pick a voice and produce sound after speak() has already returned.
  const WARM_UP_MS = 700
  clock.advance(WARM_UP_MS)
  speaker.state.handlers.onStart()

  assert.equal(sig.speaking, true, 'the schedule starts with the voice')

  const lead = sig.startedAtMs - issuedAt
  // Anchoring at issue time instead of at onStart is a lead of exactly the
  // warm-up: a whole short reply's worth of mouth movement before any sound.
  assert.equal(
    lead,
    WARM_UP_MS,
    `the schedule must anchor at onStart. Anchored ${lead}ms after issue; anchoring at issue time would put the mouth ${WARM_UP_MS}ms ahead of the voice.`,
  )
  assert.equal(sig.offsetMs, 0, 'and it starts at the beginning of the line')

  convo.dispose()
})

await asyncTest('an engine that never fires onstart still moves the mouth', async () => {
  // The other half of the same fix. Chrome has long-standing bugs where
  // onstart never arrives; without a floor the character would talk with a
  // closed mouth, which is worse than the lead the fix removes.
  const { readFileSync } = await import('node:fs')
  const source = readFileSync('src/lobby/reception/conversation.ts', 'utf8')

  assert.ok(
    /BROWSER_SPEECH_ANCHOR_FALLBACK_MS = (\d+)/.test(source),
    'a fallback anchor must exist',
  )
  const ms = Number(/BROWSER_SPEECH_ANCHOR_FALLBACK_MS = (\d+)/.exec(source)[1])
  assert.ok(ms >= 600 && ms <= 2000, `the fallback window is ${ms}ms, which is outside a sane range`)

  // It must check that nothing has started before anchoring, or a slow onstart
  // would anchor twice and jump the mouth mid-reply.
  const guard = source.split('BROWSER_SPEECH_ANCHOR_FALLBACK_MS)')[0].slice(-400)
  assert.ok(
    /signal\.speaking/.test(guard),
    'the fallback must not fire once the voice has already started',
  )
})

await asyncTest('a word boundary re-anchors the mouth without rewinding it', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const speaker = fakeVoiceOutput()
  const { convo, sig } = newConversation(adapter, { voiceOutput: speaker })
  convo.setVoiceOutput(true)
  await convo.ask('hello')
  speaker.state.handlers.onStart()
  assert.equal(sig.offsetMs, 0)
  speaker.state.handlers.onBoundary(20, 4000)
  assert.ok(sig.offsetMs > 0, `offset was ${sig.offsetMs}`)
  const forward = sig.offsetMs
  speaker.state.handlers.onBoundary(20, 5)
  assert.equal(sig.offsetMs, forward, 'a late boundary must not rewind')
  speaker.state.handlers.onEnd()
  assert.equal(sig.speaking, false)
  convo.dispose()
})

// ---------------------------------------------------------------------------
// Server speech
// ---------------------------------------------------------------------------

/** A SpokenAudio that a test drives by hand. */
function fakeAudio(outcome = 'playing') {
  const state = { played: 0, stopped: 0, position: 0, level: 0.5, ended: false }
  let onEnded = null
  return {
    state,
    finish() {
      state.ended = true
      onEnded?.()
    },
    get ended() {
      return state.ended
    },
    async play() {
      state.played += 1
      return outcome
    },
    stop() {
      state.stopped += 1
    },
    clock: () => state.position,
    envelope: () => state.level,
    onEnded(listener) {
      onEnded = listener
    },
  }
}

function fakeApi(speakResult) {
  const state = { speakCalls: [], reset: 0 }
  return {
    state,
    async capabilities() {
      return null
    },
    lastCapabilities() {
      return null
    },
    async ask() {
      return { ok: true, data: { reply: 'x', suggestions: [], actions: [] } }
    },
    async speak(text) {
      state.speakCalls.push(text)
      return speakResult
    },
    async transcribe() {
      return { ok: false, reason: 'no', code: 'x', retryable: false }
    },
    reset() {
      state.reset += 1
    },
  }
}

const AUDIO_BLOB = { size: 4096, type: 'audio/mpeg' }

await asyncTest('a server voice drives the mouth from the audio clock, not the wall clock', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const audio = fakeAudio('playing')
  const api = fakeApi({ ok: true, data: AUDIO_BLOB })
  const { convo, sig } = newConversation(adapter, {
    api,
    serverSpeech: () => true,
    voiceOutput: fakeVoiceOutput(),
    createAudio: () => audio,
  })
  convo.setVoiceOutput(true)

  await convo.ask('hello')
  await new Promise((r) => setTimeout(r, 0))

  assert.deepEqual(api.state.speakCalls, [OK_REPLY.data.text], 'the reply was sent for synthesis')
  assert.equal(audio.state.played, 1, 'the audio was played')
  assert.equal(sig.speaking, true)
  assert.equal(sig.lipSync, 'audio-reactive', 'real audio means the envelope drives the mouth')
  assert.ok(sig.clock, 'the audio clock is attached')

  audio.state.position = 750
  assert.equal(signalModule.scheduleTimeMs(sig, 999_999), 750, 'the wall clock is ignored')

  audio.finish()
  assert.equal(sig.speaking, false, 'the mouth stops when the audio ends')
  assert.equal(convo.snapshot().voice.source, 'server')
  convo.dispose()
})

await asyncTest('a blocked autoplay holds the audio and offers a tap', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const audio = fakeAudio('blocked')
  const api = fakeApi({ ok: true, data: AUDIO_BLOB })
  const { convo, sig } = newConversation(adapter, {
    api,
    serverSpeech: () => true,
    voiceOutput: fakeVoiceOutput(),
    createAudio: () => audio,
  })
  convo.setVoiceOutput(true)

  await convo.ask('hello')
  await new Promise((r) => setTimeout(r, 0))

  assert.equal(convo.snapshot().playbackBlocked, true, 'the visitor is offered a tap')
  assert.equal(audio.state.stopped, 0, 'the audio is held, not discarded')
  assert.equal(sig.speaking, false, 'and the mouth does not move while nothing is playing')
  // The reply is still readable: a blocked sound must not cost the words.
  assert.equal(convo.snapshot().turns.at(-1).text, OK_REPLY.data.text)
  convo.dispose()
})

await asyncTest('a speech failure keeps the reply and says what happened', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const speaker = fakeVoiceOutput()
  const api = fakeApi({ ok: false, reason: 'The speech service refused the request.', code: 'speech_failed', retryable: false })
  const { convo } = newConversation(adapter, {
    api,
    serverSpeech: () => true,
    voiceOutput: speaker,
    createAudio: () => fakeAudio(),
  })
  convo.setVoiceOutput(true)

  await convo.ask('hello')
  await new Promise((r) => setTimeout(r, 0))

  const snapshot = convo.snapshot()
  assert.equal(snapshot.turns.at(-1).text, OK_REPLY.data.text, 'the text survives')
  assert.ok(/refused the request/.test(snapshot.voiceNotice ?? ''), snapshot.voiceNotice ?? 'no notice')
  assert.equal(speaker.state.spoken.length, 1, 'the browser voice is the labelled fallback')
  assert.equal(snapshot.voice.source, 'browser', 'and the interface says which voice was used')
  convo.dispose()
})

await asyncTest('a cancelled turn never starts playing later', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const audio = fakeAudio('playing')
  let release
  const api = {
    ...fakeApi({ ok: true, data: AUDIO_BLOB }),
    async speak() {
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, data: AUDIO_BLOB })
      })
    },
  }
  const { convo, sig } = newConversation(adapter, {
    api,
    serverSpeech: () => true,
    voiceOutput: fakeVoiceOutput(),
    createAudio: () => audio,
  })
  convo.setVoiceOutput(true)

  await convo.ask('first')
  convo.interrupt()
  release()
  await new Promise((r) => setTimeout(r, 0))

  assert.equal(audio.state.played, 0, 'audio for a cancelled turn must never start')
  assert.equal(sig.speaking, false)
  assert.equal(sig.clock, null, 'and no clock is left attached')
  convo.dispose()
})

await asyncTest('pressing Talk stops the voice before opening the microphone', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const audio = fakeAudio('playing')
  const voice = fakeVoiceInput()
  const speaker = fakeVoiceOutput()
  const api = fakeApi({ ok: true, data: AUDIO_BLOB })
  const { convo } = newConversation(adapter, {
    api,
    serverSpeech: () => true,
    voiceInput: voice,
    voiceOutput: speaker,
    createAudio: () => audio,
  })
  convo.setVoiceOutput(true)

  await convo.ask('hello')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(audio.state.stopped, 0)

  await convo.startVoice()
  // Otherwise the recording captures the receptionist's own voice and
  // transcribes it back as the visitor's next question.
  assert.ok(audio.state.stopped >= 1, 'playing audio must stop before the microphone opens')
  assert.ok(speaker.state.cancelled >= 1, 'and so must the browser voice')
  convo.dispose()
})

await asyncTest('disposing releases the audio and the session', async () => {
  const adapter = fakeAdapter(OK_REPLY)
  const audio = fakeAudio('playing')
  const api = fakeApi({ ok: true, data: AUDIO_BLOB })
  const { convo } = newConversation(adapter, {
    api,
    serverSpeech: () => true,
    voiceOutput: fakeVoiceOutput(),
    createAudio: () => audio,
  })
  convo.setVoiceOutput(true)
  await convo.ask('hello')
  await new Promise((r) => setTimeout(r, 0))

  convo.dispose()
  assert.ok(audio.state.stopped >= 1, 'the audio element is released')
  assert.equal(api.state.reset, 1, 'and the visitor session is dropped')
})

// ---------------------------------------------------------------------------
// The procedural face
// ---------------------------------------------------------------------------

test('the head ships seventeen named, relative morph targets', () => {
  const geometry = face.buildHeadGeometry()
  const targets = geometry.morphAttributes.position
  assert.equal(targets.length, 17)
  assert.equal(geometry.morphTargetsRelative, true)
  const known = new Set(visemes.FACE_CONTROLS)
  for (const attribute of targets) {
    assert.ok(attribute.name, 'every morph target must be named')
    assert.ok(known.has(attribute.name), `${attribute.name} is not a control the lobby declares`)
    assert.equal(attribute.count, geometry.getAttribute('position').count)
  }
  geometry.dispose()
})

test('jawOpen moves the jaw and leaves the crown alone', () => {
  const geometry = face.buildHeadGeometry()
  const positions = geometry.getAttribute('position')
  const jaw = geometry.morphAttributes.position.find((a) => a.name === 'jawOpen')
  let lowestMove = 0
  let crownMove = 0
  for (let i = 0; i < positions.count; i += 1) {
    const y = positions.getY(i)
    const move = Math.hypot(jaw.getX(i), jaw.getY(i), jaw.getZ(i))
    if (y < -0.06) lowestMove = Math.max(lowestMove, move)
    if (y > 0.07) crownMove = Math.max(crownMove, move)
  }
  assert.ok(lowestMove > 0.02, `the jaw moved only ${(lowestMove * 1000).toFixed(1)} mm`)
  assert.ok(lowestMove < 0.05, 'a jaw that drops more than 50 mm is a puppet')
  assert.ok(crownMove < 0.0005, `the crown moved ${(crownMove * 1000).toFixed(2)} mm`)
  geometry.dispose()
})

test('left and right shapes are mirror images', () => {
  const geometry = face.buildHeadGeometry()
  const positions = geometry.getAttribute('position')
  const left = geometry.morphAttributes.position.find((a) => a.name === 'mouthSmileLeft')
  const right = geometry.morphAttributes.position.find((a) => a.name === 'mouthSmileRight')
  let leftTotal = 0
  let rightTotal = 0
  for (let i = 0; i < positions.count; i += 1) {
    const magnitude = Math.hypot(left.getX(i), left.getY(i), left.getZ(i))
    if (positions.getX(i) > 0.01) leftTotal += magnitude
    const other = Math.hypot(right.getX(i), right.getY(i), right.getZ(i))
    if (positions.getX(i) < -0.01) rightTotal += other
  }
  assert.ok(leftTotal > 0 && rightTotal > 0)
  assert.ok(Math.abs(leftTotal - rightTotal) / leftTotal < 0.05,
    `smile is lopsided: ${leftTotal.toFixed(4)} vs ${rightTotal.toFixed(4)}`)
  geometry.dispose()
})

test('lip and brow patches face outwards', () => {
  // A patch wound the wrong way is invisible rather than wrong-looking, which
  // is the hardest kind of geometry bug to spot in a screenshot.
  const patch = face.patchGeometry(0.095, 0.019, 0.006)
  const normals = patch.getAttribute('normal')
  const positions = patch.getAttribute('position')
  let outward = 0
  for (let i = 0; i < normals.count; i += 1) {
    if (normals.getZ(i) > 0.5) outward += 1
  }
  assert.equal(outward, normals.count, 'every vertex normal must point away from the skull')
  // And the patch must curve away at its edges rather than being flat, or it
  // sinks into a face that is not flat either.
  let deepest = 0
  for (let i = 0; i < positions.count; i += 1) deepest = Math.min(deepest, positions.getZ(i))
  assert.ok(deepest < -0.0005, `patch is flat (deepest ${deepest})`)
  patch.dispose()
})

test('the face parts sit outside the skull, not inside it', () => {
  const built = face.createProceduralFace()
  built.group.updateWorldMatrix(true, true)
  const seen = new Set()
  built.group.traverse((child) => {
    if (!child.isMesh) return
    const world = child.getWorldPosition(child.position.clone())
    const radius = Math.hypot(world.x, world.y, world.z)
    if (radius > 0.02) seen.add(Math.round(radius * 1000))
  })
  // The mouth, the brows and the eyes all sit near the surface. A part left at
  // the head's origin is a part nobody will ever see.
  assert.ok(seen.size >= 2, `face parts are bunched at the origin: ${[...seen]}`)
  built.dispose()
})

test('the assembled face exposes a usable rig', () => {
  const built = face.createProceduralFace()
  const controls = new Set(built.rig.controls)
  for (const required of ['jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'browInnerUp']) {
    assert.ok(controls.has(required), `rig is missing ${required}`)
  }
  const probed = capability.faceCapabilityFrom(built.rig.controls)
  assert.equal(probed.canShapeMouth, true)
  assert.equal(probed.canOpenJaw, true)
  assert.equal(probed.canBlink, true)
  assert.equal(
    capability.chooseLipSyncMode(probed, { visemeEvents: false, analyser: false, text: true }),
    'text-estimated',
  )
  assert.ok(built.triangles > 500 && built.triangles < 6000, `${built.triangles} triangles`)
  built.dispose()
})

test('applying a pose actually writes the influences', () => {
  const built = face.createProceduralFace()
  let head = null
  built.group.traverse((child) => {
    if (child.morphTargetDictionary && child.morphTargetDictionary.jawOpen !== undefined) head = child
  })
  assert.ok(head, 'the head mesh exposes a morph dictionary')
  built.rig.apply({ jawOpen: 1, mouthSmileLeft: 0.5 })
  assert.equal(head.morphTargetInfluences[head.morphTargetDictionary.jawOpen], 1)
  assert.equal(head.morphTargetInfluences[head.morphTargetDictionary.mouthSmileLeft], 0.5)
  built.rig.apply({})
  assert.equal(head.morphTargetInfluences[head.morphTargetDictionary.jawOpen], 0,
    'an empty pose must reset every control, not leave the last one held')
  built.dispose()
})

test('every viseme is expressible by the procedural rig', () => {
  const built = face.createProceduralFace()
  const controls = new Set(built.rig.controls)
  for (const viseme of visemes.OVR_VISEMES) {
    const pose = visemes.VISEME_TO_ARKIT[viseme]
    const keys = Object.keys(pose)
    if (keys.length === 0) continue
    const drivable = keys.filter((key) => controls.has(key))
    assert.ok(drivable.length > 0, `${viseme} has no drivable control on this rig`)
  }
  built.dispose()
})

// ---------------------------------------------------------------------------
// Measurement hook
// ---------------------------------------------------------------------------

test('the measurement mode defaults safely', () => {
  assert.equal(measure.detectCharacterMode('?lobbyCharacter=off'), 'off')
  assert.equal(measure.detectCharacterMode('?lobbyCharacter=speaking'), 'speaking')
  assert.equal(measure.detectCharacterMode('?lobbyCharacter=nonsense'), 'idle')
  assert.equal(measure.detectCharacterMode(''), 'idle')
})

test('the audio clock is preferred over the wall clock whenever audio is playing', () => {
  const sig = signalModule.createReceptionSignal()
  sig.lipSync = 'text-estimated'
  signalModule.beginSpeaking(sig, visemes.visemeTimeline('hello there'), 1000)

  // No audio: the schedule runs on the wall clock, measured from the start.
  assert.equal(signalModule.scheduleTimeMs(sig, 1500), 500)

  // With audio: the wall clock is ignored entirely. It measures how long ago
  // the request was made, which includes the round trip and the decode.
  sig.clock = () => 120
  assert.equal(signalModule.scheduleTimeMs(sig, 9999), 120)

  signalModule.endSpeaking(sig)
  assert.equal(sig.clock, null, 'a stopped reply must not leave a clock attached')
})

test('the speaking measurement keeps the mouth moving', () => {
  const sig = signalModule.createReceptionSignal()
  const stop = measure.driveMeasurement(sig, 'speaking')
  assert.equal(sig.state, 'speaking')
  assert.equal(sig.lipSync, 'text-estimated')
  assert.ok(sig.timeline.length > 20)
  stop()
  assert.equal(sig.state, 'idle')
  assert.equal(sig.speaking, false)
})

// ---------------------------------------------------------------------------
// Architecture guards
// ---------------------------------------------------------------------------

await asyncTest('the demo and live adapters still cannot reach each other', async () => {
  const { readFileSync } = await import('node:fs')
  const demo = readFileSync('src/lobby/services/demoAdapter.ts', 'utf8')
  const live = readFileSync('src/lobby/services/liveAdapter.ts', 'utf8')
  assert.ok(!/from '\.\/liveAdapter'/.test(demo), 'demoAdapter must not import liveAdapter')
  assert.ok(!/from '\.\/demoAdapter'/.test(live), 'liveAdapter must not import demoAdapter')
})

await asyncTest('no provider credential is read in the browser bundle', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = `${dir}/${entry}`
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(path)) {
        const source = readFileSync(path, 'utf8')
        // VITE_* is inlined into the bundle, so anything key-shaped there is
        // published. The lobby's voice uses the browser engine and needs none.
        const matches = source.match(/import\.meta\.env\.VITE_[A-Z_]*(KEY|SECRET|TOKEN|CREDENTIAL)[A-Z_]*/g)
        if (matches) offenders.push(`${path}: ${matches.join(', ')}`)
      }
    }
  }
  walk('src/lobby')
  assert.deepEqual(offenders, [])
})

await asyncTest('speech never starts itself', async () => {
  const { readFileSync } = await import('node:fs')
  const speech = readFileSync('src/lobby/reception/speech.ts', 'utf8')
  // Two engines now — the browser recogniser and the server recorder — and each
  // opens the microphone in exactly one place: its own start().
  const opens = [...speech.matchAll(/getUserMedia\(/g)]
  assert.equal(opens.length, 2, 'the microphone is opened in exactly two places')
  for (const match of opens) {
    const before = speech.slice(0, match.index)
    const lastStart = before.lastIndexOf('async start(')
    const lastStop = before.lastIndexOf('    stop()')
    assert.ok(lastStart > lastStop, 'every getUserMedia must sit inside a start()')
  }
  // And each engine stops every track it opened.
  assert.equal(
    (speech.match(/for \(const track of stream\.getTracks\(\)\) track\.stop\(\)/g) ?? []).length,
    2,
    'both engines must release every captured track',
  )
  const convoSource = readFileSync('src/lobby/reception/conversation.ts', 'utf8')
  assert.ok(/let outputEnabled = false/.test(convoSource), 'the opt-in starts off')
  // Every route that makes a sound is gated on it — the server voice and the
  // browser voice alike. Behaviour is pinned by the tests above; this catches
  // a third path being added without the gate.
  assert.ok(/if \(!outputEnabled \|\| !voiceOutput\) return false/.test(convoSource), 'the browser voice is gated')
  assert.ok(/if \(outputEnabled && api && serverSpeech\(\)\)/.test(convoSource), 'the server voice is gated')
})

// ---------------------------------------------------------------------------
// The face pose, composed once per frame into a reused object
// ---------------------------------------------------------------------------

{
  const { composeFacePose } = await load('/src/lobby/reception/faceRig.ts')

  test('a viseme does not survive into the next frame', () => {
    const scratch = {}

    // Frame 1: speaking, one viseme at full strength.
    composeFacePose(scratch, {}, { viseme_aa: 1 })
    assert.equal(scratch.viseme_aa, 1, 'the viseme applies while it is being spoken')

    // Frame 2: silent. Nothing should be left holding the mouth open.
    composeFacePose(scratch, {}, null)
    assert.equal(scratch.viseme_aa, 0, 'and is released the moment it stops')
  })

  test('visemes do not accumulate frame over frame', () => {
    const scratch = {}
    for (let frame = 0; frame < 30; frame += 1) composeFacePose(scratch, {}, { viseme_nn: 0.2 })

    assert.equal(
      scratch.viseme_nn,
      0.2,
      'thirty frames of the same viseme is still that viseme, not a mouth pinned at 1',
    )
  })

  test('an expression and a viseme on the same control add, within one frame', () => {
    const scratch = {}
    composeFacePose(scratch, { jawOpen: 0.3 }, { jawOpen: 0.5 })
    assert.equal(Math.round(scratch.jawOpen * 100) / 100, 0.8, 'they combine')

    composeFacePose(scratch, { jawOpen: 0.8 }, { jawOpen: 0.8 })
    assert.equal(scratch.jawOpen, 1, 'and are clamped rather than driven past full')
  })

  test('an expression control that stops being posed returns to zero', () => {
    const scratch = {}
    composeFacePose(scratch, { mouthSmileLeft: 0.9 }, null)
    assert.equal(scratch.mouthSmileLeft, 0.9, 'the smile applies')

    composeFacePose(scratch, {}, null)
    assert.equal(scratch.mouthSmileLeft, 0, 'and clears when the state no longer asks for it')
  })
}


// ---------------------------------------------------------------------------
// Phase 3 — the handover journey, and what a demonstration may claim
// ---------------------------------------------------------------------------

await asyncTest('the demonstration never shows a queue position or a wait', async () => {
  const { demoAdapter } = await load('/src/lobby/services/demoAdapter.ts')

  const asked = await demoAdapter.requestHandover('Asha', 'Delivery')
  assert.equal(asked.status, 'ok')
  assert.equal(asked.data.demo, true, 'it must be labelled a demonstration')
  assert.equal(asked.data.state, 'requested', 'and must not claim to have been queued')
  assert.equal(asked.data.ahead, 0, 'a demo must never invent a position')
  assert.equal(asked.data.staffed, false, 'and must never claim somebody is there')
  assert.ok(
    /nobody was alerted/i.test(asked.data.message),
    'the sentence must say plainly that nobody was alerted',
  )
})

await asyncTest('the live handover reports only what the server recorded', async () => {
  const { readFileSync } = await import('node:fs')
  const live = readFileSync('src/lobby/services/liveAdapter.ts', 'utf8')

  // Each of the three handover methods must return unavailable on failure
  // rather than a status object. A fabricated position here is the failure
  // this whole product is shaped around avoiding, and it would be one line.
  for (const method of ['requestHandover', 'handoverStatus', 'cancelHandover']) {
    const body = live.split(`async ${method}(`)[1]?.split('\n  },')[0] ?? ''
    assert.ok(body, `${method} must exist in the live adapter`)
    assert.ok(
      /if \(!result\.ok\) return unavailable\(/.test(body),
      `${method} must report unavailable on failure, not a status`,
    )
    assert.ok(/demo: false/.test(body), `${method} must never mark a live result as a demonstration`)
  }
})

await asyncTest('a journey the business switched off is not offered to a visitor', async () => {
  const { readFileSync } = await import('node:fs')
  const centre = readFileSync('src/lobby/ui/ServiceCentre.tsx', 'utf8')

  assert.ok(/function offered\(/.test(centre), 'the service list must be filtered')
  assert.ok(
    /journeys\.booking/.test(centre) && /journeys\.handover/.test(centre),
    'booking and handover must both be gated on the published configuration',
  )
  assert.ok(
    /\{visible\.map\(/.test(centre) && !/\{SERVICES\.map\(/.test(centre),
    'the filtered list must be the one rendered',
  )
})

await asyncTest('the staff surface is not in the bundle a visitor downloads', async () => {
  const { readFileSync } = await import('node:fs')
  const app = readFileSync('src/App.tsx', 'utf8')

  assert.ok(
    /lazy\(\(\) => import\('\.\/admin\/AdminShell'\)/.test(app),
    'AdminShell must be loaded lazily, not bundled into the entry chunk',
  )
  assert.ok(
    !/^import \{ AdminShell \}/m.test(app),
    'and must not also be imported statically',
  )
})

await asyncTest('no staff route is reachable without the portal bearer token', async () => {
  const { readFileSync } = await import('node:fs')
  const api = readFileSync('src/admin/adminApi.ts', 'utf8')

  assert.ok(/getSesKey\(\)/.test(api), 'the admin client must read the portal session key')
  assert.ok(
    /authorization: `Bearer \$\{token\}`/.test(api),
    'and must send it as a bearer token',
  )
  // The visitor session header must not appear anywhere in the staff client.
  // The two credentials are separate on the server; a browser that sent both
  // would be the first step towards them not being.
  assert.ok(
    !/x-lobby-session/i.test(api),
    'the staff client must never send the anonymous visitor session token',
  )
})

// ---------------------------------------------------------------------------

clearTimeout(watchdog)
await server.close()

const width = Math.max(...results.map((r) => r.name.length))
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name.padEnd(width)}${result.ok ? '' : `  ${result.error}`}`)
}
console.log(`\n${results.length - failures}/${results.length} passed`)
process.exit(failures === 0 ? 0 : 1)
