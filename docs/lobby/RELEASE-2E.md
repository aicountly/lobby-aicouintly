# Phase 2E — the approved receptionist, as far as it goes

| | |
| --- | --- |
| Repository | `aicountly/lobby-aicouintly` |
| Branch | `claude/optimistic-einstein-ollvhw` |
| Base | `main` at `1fd3811` |
| Deployed | **Nothing.** Prepared for review, as the brief asks |

## The headline, first

A real rigged human in business dress now stands at the desk, with a complete
facial rig and every budget met. **She is not the woman in the approved
reference**, and nothing here should be read as claiming she is. What was asked
for was a specific AI-generated likeness; what is achievable from this build
environment is the closest licensed human that exists on the one reachable host.

The gap is listed, item by item, in [ASSETS.md](ASSETS.md#how-far-it-is-from-the-approved-reference).

## Asset access, rechecked once

Every image-to-3D and character-generation service is refused by the egress
policy: Meshy, Tripo, Rodin, Luma, CSM, Alpha3D, Replicate, Hugging Face and
Stability. So are Ready Player Me, Mixamo, Poly Haven and Sketchfab. No
generation credential exists in the environment, and Console — which brokers
every AI credential in the fleet — carries only Google, OpenAI and Anthropic
text providers, with no 3D or image-to-3D module in its registry.

`raw.githubusercontent.com` and `github.com` over git are reachable. That is the
whole surface, and it is where the character came from.

## What was found there

**Microsoft RocketBox**, MIT licensed: 115 rigged human avatars with ARKit
blendshapes contributed in 2022. `Business_Female_01` wears a tailored trouser
suit, a light blouse and low heels — the silhouette the reference asks for — on
a warm medium complexion with brown eyes.

MIT permits redistribution in a public web bundle, which matters because the
lobby is served as static files.

## What had to be built to use it

The source is FBX at 3ds Max scale with 175 blendshapes and a Biped skeleton.
`scripts/build-rocketbox-character.mjs` converts it, and running it against the
source reproduces the shipped file. Five steps, each of which was necessary:

1. Centimetres to metres.
2. Morph names normalised to the lobby's own ARKit and `viseme_*` vocabulary —
   including four visemes RocketBox spells differently (`KK`/`I`/`O`/`U`
   against `kk`/`ih`/`oh`/`ou`), which would otherwise have been silently lost.
3. 108 unused targets dropped (Vive tracker and FACS sets nothing drives).
4. **UV V-flip.** FBX and glTF disagree about V=0. Without it the legs sample
   the hands and the mouth renders on the throat.
5. **Geometry welded.** The FBX is non-indexed, so every morph target held three
   copies of each shared vertex: 19 MB became 3.9 MB.

`skeletonPoser.ts` gained a second rig convention. MakeHuman settles an arm
about the bone's local X with the same sign on both sides; RocketBox about local
Y with mirrored signs. Every angle came from loading the model and reading world
positions, not from reasoning about anatomy — including the wave, where
abducting the upper arm alone reads as "stop" and the forearm bend is what puts
the hand beside the head.

## The preview harness, and what it caught

`scripts/preview-character.mjs` renders any character from front,
three-quarter, side and rear, then the face in neutral, smile, blink, mouth-open
and a viseme, then the greeting pose. Development only; it is not in the bundle.

It earned itself immediately. It caught the UV flip, and it caught a suit
recolour that looked plausible in principle and wrong on screen.

**The emerald recolour was attempted and reverted.** RocketBox packs suit, skin
and blouse into one atlas, so no luminance-and-chroma rule separates them: the
hands and lower legs turned green while parts of the trousers stayed skin-toned.
It is not shipped, and ASSETS.md records it as an outstanding difference rather
than a solved one.

## Verification

| | |
| --- | --- |
| `php server-php/tests/run.php` | **36 / 36** |
| `npm run test:reception` | **93 / 93** |
| `npm run test:ui` | **23 / 23** |
| `npm run build`, `tsc -b` | clean |
| `npm run inspect:character` | ARKit 52/52, OVR 15/15, 80 bones, 8,966 triangles |
| Missing-asset fallback | model 404 → room renders, Talk works, generated character takes over, warning logged |

Facial controls were rendered rather than declared: the blink closes both lids
without distorting the cheeks, the jaw opens with the teeth inside the mouth,
the smile stays restrained, and `viseme_aa` produces a real vowel shape.

### Performance, identical conditions

| | MakeHuman | RocketBox |
| --- | --- | --- |
| Scene triangles | 197,382 | **47,942** |
| Character triangles | 83,686 | **8,966** |
| Character draw calls | 8 | **7** |
| Shader programs | 39 | **29** |
| Download | 5.71 MB | **3.89 MB** |

Counts, not frame timings. This environment is software-rendered and its frame
times would mean nothing on a device.

## What is preserved

The room, 360° movement, collisions, destinations, HUD Talk and Sound, the
approach greeting, captions, the conversation panel, the Console credential
path, speech and transcription, Standard View and reduced motion are all
untouched. The previous character stays in git history.

## What is NOT done

- **The approved likeness.** Different face, charcoal suit not emerald, short
  hair not long half-up, no badge, no earrings.
- **No real-device testing**, and no audio in this environment.
- **Reception still answers nothing in production** until a credential is bound
  in Console. Unchanged by this phase.

## To close the remaining gap

One of:

1. **A compatible model file** — `.glb`, metres, Y-up, +Z facing, humanoid rig
   under 80 bones, ARKit 52 as glTF morph targets with `extras.targetNames`.
   Drop it into `web/public/lobby-assets/`, point the manifest at it, and run
   `npm run inspect:character` then `node scripts/preview-character.mjs`. Both
   tools exist and work.
2. **Access to a generation service** — an authorised credential for an
   image-to-3D service, plus permission to spend on it. The prompt to use is in
   the brief and is reproduced in ASSETS.md.

## Rollback

```bash
# Whole phase, including the poser changes:
git revert <commit>

# Or the character alone, keeping the tooling and the docs:
git checkout <previous-commit> -- web/public/lobby-assets/receptionist.glb
git checkout <previous-commit> -- web/public/lobby-assets/receptionist.mapping.json
npm --prefix web run build
```

The previous character is not committed a second time: a duplicate in `public/`
is rsynced to the document root on every deploy, and 5.8 MB of asset nobody
loads is worse than one `git checkout`.

The procedural character remains the final fallback and mounts whenever no model
loads, so the room is never empty.
