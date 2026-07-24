# Design-thread concepts → real codebase symbols

Every concept the design thread proposes, checked against the code **before** anything is built.

Written because the proposals were reported once without this check. That is the same
presence-vs-reality error the gates exist to catch, committed at the planning layer: a concept named
in a thread is a *claim*, and until it is resolved to a symbol it is unverified. Absent is recorded
as absent — never quietly treated as "to be built as described".

Source: thread `6a502aa2` — turn 17 (Deck Direction / ExperienceSpec) and turn 19 (Room-Ready
Director). Turn indices matter: an earlier read of this thread mislabeled turn 17 as the latest when
turn 19 existed, so anything attributed here names its turn.

## Verified present

| Thread concept | Real symbol | Note |
|---|---|---|
| `StorySpec` | `NodeSlideStorySpec` — `nodeslide/convex/lib/nodeslideStoryContext.ts:47` | `narrativeJob`, `audienceNeed`, `memorableTakeaway`, `proofObligations[]`, `pacing[]` |
| "three slide variations" | `NodeSlideCompositionVariant = 'canonical' \| 'mirrored' \| 'visual-focus'` — `nodeslideCompositionFanout.ts:11` | **Confirms the thread's diagnosis**: these are slide-level, not deck-level |
| design plans | `NodeSlideDesignPlan` — `nodeslide/convex/lib/nodeslideDesignPlan.ts:26` | consumes StorySpec |
| trace tab | `InspectorTab` includes `'trace'` | |
| AI tab | `InspectorTab` includes `'ai'` | |
| **"Deck Direction" (turn 17)** | **`SignatureProfile` — `parity-studio/shared/nodeslideSignature.ts:136`; `NodeSlideTastePack extends SignatureProfile` — `signature/packs/types.ts:101`; UI panel labelled **"Deck direction"** at `inspector/DesignInspector.tsx:1399`** | **NOT greenfield — see below** |

### Deck Direction is not greenfield, and the distinction that matters

A first version of this map filed `DeckDirection` under "absent — zero occurrences". That was wrong
in the way this document exists to prevent: it grepped for the **identifier** and concluded the
**concept** was missing. A fresh-context evaluator caught it. parity-studio already ships a panel
whose eyebrow literally reads "Deck direction", backed by a real type system.

`SignatureProfile` already carries most of what turn 17's `DeckDirection` proposes:

| turn 17 `DeckDirection` | shipped `SignatureProfile` |
|---|---|
| `tokenSetId` | `id`, `source.digest` |
| `typography.{display,body,mono,scale}` | `tokens.fontFamilies`, `tokens.fontSizes` |
| `palette` | `tokens.colors` |
| spacing / layout language | `layout: SignatureLayoutTendencies` |
| — | `evidence[]`, `confidence`, `warnings[]` (extra) |

**The real gap is direction, not vocabulary.** `SignatureProfile` is *descriptive*: it is extracted
FROM an existing deck (`source.kind`, `source.digest`, `evidence`, `confidence` are all observations
of something that already exists). Turn 17 asks for something *prescriptive*: three directions
authored FOR a deck that does not exist yet, which a human picks between.

So the honest framing is not "build DeckDirection" but **"can SignatureProfile be authored forward
as well as extracted backward?"** — one token vocabulary, two directions. Building a parallel
`DeckDirection` type beside `SignatureProfile` would create exactly the second schema owner turn 19
warns against, one layer over.

**StorySpec consumers** (would inherit any extension): `nodeslideStoryContext.ts`,
`nodeslideDesignPlan.ts`, `nodeslideSeed.ts`.

## Verified absent — do not describe as existing

Absent **as identifiers**. Where a concept exists under another name, it is listed in the present
table instead — the `DeckDirection` row above is exactly that case, and is why this table is scoped
to identifiers rather than ideas.

| Thread concept | Grep result |
|---|---|
| `DeckDirection` (turn 17) | identifier absent, but **the concept ships as `SignatureProfile`** — see above |
| `ExperienceSpec` (turn 17) | zero occurrences; no equivalent concept found |
| `RoomReady` / `room-ready` (turn 19) | zero occurrences; no equivalent concept found |
| `decisionSentence` | absent |
| `objection` | absent |
| `timeBudget` | absent |
| `rehears*` | **not absent** — `build-atlas-v3-native.mjs:1233`, `build-atlas-native-pptx.mjs:377`, `docs/demo/founder-roadshow/storyboard.json:130` ("Rehearse and share the approved story"). No *symbol*, but the word ships in a demo storyboard step |

Partial anchors only: `stakeholder` appears in `nodeslideSeed.ts`; `decision` appears in
`nodeslideCreationCritique.ts` and `nodeslideStoryBench.ts` — neither is a decision *sentence*.

## The correction the thread's UI sketch needs

Turn 19 sketches a right sidebar of `AI · Story · Room · Evidence · Rehearse · Trace`.

The shipped union is:

```ts
InspectorTab = 'ai' | 'design' | 'comments' | 'versions' | 'data' | 'json' | 'trace'
```

Only `ai` and `trace` overlap. **The sketch silently drops five shipped tabs** — `design`,
`comments`, `versions`, `data`, `json`. Building to that diagram literally would delete working
surfaces. Treat it as a proposal for *additions*, never as the target state.

## Room-Ready's five tests, mapped

| Test (turn 19) | Existing anchor | Real gap |
|---|---|---|
| Decision sentence | `pacing[]` already has a `'decide'` phase | no decision-sentence field |
| Room map | `audienceNeed` (a single string) | not a stakeholder map |
| Objection slide | — | absent |
| One-slide test | `memorableTakeaway` | present but unenforced |
| Half-time rehearsal | `pacing[].slideCount` | no time budget |

Three of five have partial anchors, which is why the thread's own instruction — *"do not create
another canonical schema owner; extend StorySpec"* — is the right call and is followed.

## Unresolved contradiction (open)

Turn 17 (Deck Direction) and turn 19 (Room-Ready) both want to own deck-level decisions.
`DeckDirection` carries typography/palette/motion; Room-Ready carries decision/room/pacing. They may
compose — Room-Ready deciding *what the deck must accomplish*, Deck Direction *how it looks* — but
that is inference, not something either turn states. **Resolve by council hop before building
either.** Recorded as open rather than assumed.
