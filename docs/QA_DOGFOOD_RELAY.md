# QA Dogfood Relay

Parity Studio and `easier-to-read-submissions` now share one proof shape for visible feature work.

## Division of responsibility

| System | Owns | Output |
|---|---|---|
| Parity Studio | Capture, decompose, comment/edit, verify, explain end-user impact, export design proof | `ui_kits/<slug>/qa-dogfood.packet.json` plus proof files |
| easier-to-read-submissions | Repo-local submission readability, changelog lanes, reviewer packet, agent handoff | `QA_DOGFOOD/<feature-id>/` plus lane updates |

Parity is the design and verification workspace. The skill repo is the portable way to package the evidence for any codebase.

## Native design-mission output

Every `parity_design_mission` kit now includes these files by default:

```txt
ui_kits/<slug>/
  qa-dogfood.packet.json
  qa-dogfood.plan.md
  snapshot-snippets.json
  gmail-magic-resend.html
  remotion.storyboard.json
  easier-to-read-submission.md
```

Disable with `qaDogfoodRelay=false` only for minimal experiments.

## End-to-end workflow

```txt
user asks for design change
  -> agent calls parity_design_mission
  -> Parity captures source route and creates design board
  -> user comments/selects/edits in Parity
  -> agent runs browser QA and updates packet links
  -> Parity exports approved ui_kit ZIP
  -> downstream repo runs npx easier qa <feature-id>
  -> agent copies Parity packet evidence into QA_DOGFOOD/<feature-id>/
  -> agent updates CHANGELOG lanes
  -> reviewer gets Gmail/PR packet with links, GIF/MP4, snippets, and correction prompts
```

## Minimum packet fields

- `featureId`: stable id such as `nodebench.chat.declutter.v1`
- `previewUrl`: deployed preview, localhost, or Parity run URL
- `workflows`: clear lanes for happy path, correction path, mobile, desktop, empty state, and error state
- `personas`: at least first-time user, product reviewer, and coding agent maintainer
- `userStates`: new, returning, needs fix, approved
- `snippets`: component slug plus before/after/diff, expected change, actual result, verdict, and correction prompt
- `media`: GIF, MP4, Remotion storyboard, and verification status
- `security`: no provider keys, no raw secrets, only redacted artifacts and user-approved proof media

## Gmail Magic Resend

The generated `gmail-magic-resend.html` is intentionally static. It is safe to paste into an email draft after filling links. It should link to proof artifacts instead of embedding secrets or raw model output.

Required email sections:

- Preview/test link
- GIF/MP4 links
- Before/after snippet table
- End-user impact
- Approve / needs-fix / correction-prompt actions
- Known gaps

## Remotion bridge

`remotion.storyboard.json` is not a renderer. It is the deterministic storyboard contract a repo-specific Remotion script can consume:

- intro scene
- screenshot compare scene
- workflow GIF scene
- snippet grid scene
- QA status scene

This keeps the video composition deterministic while allowing each downstream app to own its Remotion runtime.

## Acceptance criteria

- A design mission ZIP contains the QA relay files.
- The MCP smoke test still lists `parity_design_mission`.
- `npx easier qa <feature-id>` creates the matching repo-local packet folder.
- The packet can be used without Parity secrets or model provider keys.
- Production code changes remain blocked until the Parity design board and QA packet are approved.
