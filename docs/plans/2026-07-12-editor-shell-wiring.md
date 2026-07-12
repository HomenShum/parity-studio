# Editor shell wiring map — v2 mock → real system (2026-07-12)

Source of truth for intended interactions: `NodeSlide Editor v2.dc.html` in Claude Design project
3ae192f6 (the in-app agent's interactive mock; it calls window.claude.complete live). Right-rail
markup reference: `NodeSlide Editor Shell.dc.html` (rail spliced 2026-07-12, binding-compatible).
Targets below name the REAL primitives (challenge-repo names; NodeSlide/parity-studio equivalents in
brackets where they differ).

## Wiring table
| v2 mock behavior | Real target | Status |
|---|---|---|
| send(): busy escalation "Reading selection and sources…" → 900ms → "Drafting patch…" | client-side staged status labels around chatSend (single timer, no server change) | new, trivial |
| send(): 12s Promise.race timeout | client timeout on the action call, honest failure notice | new, trivial |
| scope = selectedEl carried into prompt + trace ("scope: headline") | selection blockId → chatSend arg → CHAT_SYSTEM writeScope constraint; ops outside scope contained server-side [NodeSlide: scoped workspace already exists] | partial: selection UI missing in challenge app |
| element selection (click block → chips follow, Escape deselects) | canvas data-block-id onClick → selection state → context chips in rail; commentChip variant when opened from a comment | new UI, small |
| proposal {headline, sub, note} | EditOp[] + derived summary (exists); note = agent reply text (exists) | done |
| previewProposal → Compare mode | Compare = compileDeck(applyOps(spec, proposal.ops)) rendered beside baseline — applyOps is pure and already client-side; ZERO new server surface. Ops pinned on the seam per shell-modes card | new render mode, medium |
| acceptProposal → mutate + version row 'verified' + chat confirm | decideProposal accept (exists) + trace/receipt mirror into Versions/Trace tabs (exists server-side; rail rendering new) | partial |
| accept with commentChip → linked comment auto-resolves | resolve ONLY when the ask originated from that comment (v2's answer to the auto-resolve contract question — adopt this rule) [NodeSlide comment linking exists] | decision recorded |
| offer after accept → previewPropagation → Overview with amber dots on matching slides → applyAcross | PROPAGATION: find slides with matching role/kind → second, separately-previewed deck-level proposal (never widen the original patch). applyAcross = one batch through applyPatch; internal actors may need op-cap chunking (>8 ops) | NEW SURFACE #1 |
| Overview canvas mode (thumbnail grid, previewAcross halos) | grid of SlideView thumbs (DeckCard pattern) + affected-slide halo | new render mode, small |
| commitEdit inline text editing | inline contentEditable commit → applyPatch (replaces dbl-click modal) | upgrade, small |
| undo/redo via `_snapshot` history | client undo stack over version IDs for ergonomics; server versions remain truth [NodeSlide `restoreVersion` exists] | live |
| `@` references | resolve stable same-deck IDs into bounded `readContext`; references never widen `PatchScope` | backend + UI contract |
| `/` commands | versioned server capability registry; `/variations` delegates to the existing `VariationBatch` authority | backend + UI contract |
| design behavior | server-validated `preserve / refine / rebalance / reinterpret / reimagine` plus reference-use policy | backend + UI contract |
| compare sub-modes | side-by-side, slider, overlay, and blink over one baseline/candidate pair and one receipt | client render modes |
| comment → Send to AI | comment chip creates `scope.kind = comment`; only a patch originating from that comment may change its lifecycle | UI wiring + existing server scope |
| comments after linked acceptance | linked acceptance may mark only its source comment addressed/resolved; unrelated comments stay open | authority invariant |
| navigator status dots | one workspace projection derived from canonical patches, comments, validations, sources, and propagation targets | shell projection |
| narrative banner | project the active slide role/claim/evidence state above every canvas mode | shell projection |
| layers group / visibility / z-order | explicit versioned patch operations; no local-only layer mutation | shared patch/schema change |
| real presence | heartbeat selected slide/elements/cursor through owner-gated `touchPresence` | existing backend, frontend wiring |
| provider route | deterministic/no-egress by default; OpenRouter free requires exact operation-specific consent | release blocker |
| candidate validation | materialize, digest, and fully validate the exact proposal before displaying a green receipt | release blocker |

## Non-negotiable responsiveness

1. Echo the user's ask immediately and show `Reading selection and sources…`.
2. Escalate to `Drafting patch…` after 900 ms without inventing progress.
3. At 12 seconds, show an honest timeout while allowing a late persisted proposal to reconcile.
4. Never mutate before review. Preview, Accept, and Decline all reference the same patch ID.
5. Never show “candidate validated” from the current deck's receipt; the receipt must be patch- and digest-bound.
6. Propagation, repair, and variation selection are distinct reviewable operations, not hidden widening.

## Authority boundaries

- `writeScope` is the only mutation authority. `readContext` is inspectable context and cannot add target IDs.
- Owner authorization occurs before quota consumption or provider egress.
- OpenRouter receives scoped content only after explicit consent; deterministic mode is the default.
- Layer visibility, grouping, ordering, inline edits, slide operations, and propagation all pass through the versioned patch path.
- Existing anonymous owner capabilities remain a controlled-preview model, not public tenant identity.
- The legacy Parity surface stays disabled in hosted builds unless explicitly enabled.

## Release sequence

1. Implement and test the shared/backend contracts against an isolated Convex deployment.
2. Integrate the shell, Compare/Overview, composer grammar, comment routing, propagation, presence, and layer controls into `NodeSlideStudio`.
3. Run the complete unit/type/lint/build/audit gate and an exact-commit isolated switch exercise.
4. Point Vercel Preview at the isolated deployment; never let a missing preview environment fall back to production.
5. Exercise fresh-user, expert, repeat-user, concurrent-edit, share/revoke, export, and rollback journeys.
6. Merge and deploy the same reviewed commit; keep experimental agentic flags closed on the shared production backend.
