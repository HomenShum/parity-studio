# NodeSlide shadcn quarantine review

Status: reviewed on 2026-07-16; do not merge wholesale.

The quarantined `codex/nodeslide-shadcn-migration` worktree changes 39 existing files (about 5.4k changed lines), replaces the established overlay/focus primitives across nearly every editor surface, and introduces nine additional UI primitives at once. That blast radius is too large for a release whose governing requirement is stable composer, inspector, proposal, trace, and export behavior.

The useful findings were folded into the consolidation branch selectively:

- portal-safe command and dropdown behavior;
- labeled, keyboard-operable modal and menu controls;
- bounded dialog scrolling and responsive inspector layouts;
- retained focus/escape behavior covered by the existing NodeSlide interaction tests.

The wholesale migration is rejected because it couples visual-library replacement to product behavior, deletes the existing modal adapter before every consumer is proven, and carries local QA artifacts and unreviewed changes to the trace, memory, landing, toolbar, and composer surfaces. NodeSlide can adopt additional shadcn primitives later only as small, independently tested substitutions with pixel proof. The quarantined worktree should be removed after this decision and the consolidation branch are safely committed.
