# NodeSlide — adoption composition

What the NodeKit research rule does to NodeSlide when the sequence is run honestly:

```
user problem → current workflow → current tools → adoption trigger → integration point
→ product shape → deployment path → distribution path → technical composition
```

The technical composition came first here, so this document runs the sequence backwards over what
already exists and reports where the two disagree.

## The finding

**NodeSlide already built the repository-native shape. Every piece of it is unpublished.**

| package | bin | published |
|---|---|---|
| `@nodeslide/cli` | `nodeslide` | **private: true** |
| `nodeslide-mcp` | `nodeslide-mcp` | **private: true** |
| `@nodeslide/agent` | — | **private: true** |
| `@nodeslide/backend` | — | **private: true** |
| `@nodeslide/client-http` | — | **private: true** |

What *is* public and deployed is the web workspace at `nodeslide.vercel.app` — a destination the
user has to open.

So the adoption path the product's own headline claim describes has no distribution, and the shape
NodeKit explicitly rejected has all of it.

## The claim manifest already states the adoption path

`qa/claims/coding-agent-builds-slides.json`, claim `agent-builds-deck`, marked **required**:

> "Let your coding agent (Claude Code, Codex) build your slides with you."

That is an entry point, an activation action, and a working surface, written down as a required
claim months before this rule existed. It was treated as a marketing sentence rather than a product
decision.

## Adoption composition, as the rule demands it

```yaml
user:
  role: coding-agent user          # NOT "person who opens a deck tool"

existingEnvironment:
  primaryTools:
    - claude_code
    - codex
    - vscode
    - github

entryPoint:
  action:
    Ask the coding agent to build or revise the deck in this repository.

installation:
  method:
    npx @nodeslide/cli init          # exists, private
    or register nodeslide-mcp        # exists, private

workingSurface:
  primary: coding_agent_thread

reviewSurface:
  primary: git_diff_on_deck_json     # DeckSpec is already canonical JSON
  secondary: pull_request

proofSurface:
  primary: nodeslide_receipts_and_gates
  secondary: exported_pptx_with_fidelity_report

distribution:
  individual: npm_package_and_mcp_registration
  team: committed_deck_json_and_required_check

rejectedProductShapes:
  - separate_chat_application        # the AI tab as a destination
  - required_second_dashboard        # the seven-tab inspector as the workspace
  - nodeslide_owned_coding_agent     # its own model picker and thread
```

## What reshapes, and what does not

**Does not change — this is the method, and it is already right.**
`nodeslide.slidelang/v1` DeckSpec as canonical JSON. The patch model with CAS version guards. The
gates, receipts, evidence binding, trace provenance. A deck that is a diffable file reviewed as a
patch *is* the repository-native product. It was built correctly and then wrapped in a destination.

**Reshapes — the workspace stops being the product.**
It becomes a *preview and review* surface, not the working surface. Today's measurement said the
chrome is 44% of a 1440px window by default. Under the destination reading that is a design problem
to be tuned. Under the adoption reading it is a category error: a viewer does not need a seven-tab
inspector, because the working surface is the agent thread and the review surface is `git diff`.

**Gets rejected — NodeSlide owning the agent thread.**
The AI tab, the model picker, the reasoning-effort control, the composer. If the user is already in
Claude Code or Codex, they have a thread, a model, and a context window. Rebuilding those inside a
web app is `separate_chat_application` from NodeKit's own reject list.

**Gets promoted — the parts already flagged as integration.**
The Notion board's top item is *"P0: JSON / Source inspector tab — see, copy, download, edit deck
JSON"*, noted as **TOP integration priority**. Under the destination reading that is one tab of
seven. Under the adoption reading it is the seam between the product and the user's real
environment, and it should not be a tab at all — it should be a file.

## The unresolved question the rule says must fail closed

NodeSlide has **two candidate users and has never chosen**:

1. **The solo founder with a board deck** — named in the AI Fund reply. Works in PowerPoint, Google
   Slides, email and a spreadsheet. Has no coding agent open. For this person the web workspace is
   correct and the CLI is meaningless.
2. **The coding-agent user** — named in the required claim above. Works in Claude Code or Codex,
   reviews in git. For this person the workspace is a detour.

These have different entry points, different activation actions, different review surfaces and
different distribution. Building for both is why the shell is heavy and why the CLI is unpublished:
neither audience was ever the answer, so neither path was finished.

Per the rule, this is an `INCOMPLETE`, not a product decision to be split down the middle.

## What today's session accidentally demonstrated

Every artifact produced today was built by a coding agent calling a script — the walkthrough deck by
`tools/brain/build-walkthrough-deck.mjs`, the showcase by `scripts/build-nodekit-showcase.mjs`. Not
once did the workspace get opened to author anything. The adoption path was exercised all day by the
one user who was actually present, and it ran entirely through the unpublished half of the product.

## Smallest next step, if the coding-agent user is chosen

Publish `@nodeslide/cli` and `nodeslide-mcp`, and make `deck.json` a first-class file in the
consuming repository. Nothing else needs building — the method already exists. The work is
distribution, not construction.
