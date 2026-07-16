# Eve NodeSlide operator

This private experiment exposes NodeSlide's existing governed proposal workflow through an Eve
agent. Convex remains the authority for deck state, validation, version clocks, and review commits.

## Requirements

- Node.js 24 or newer (required by Eve 0.24.4)
- A private or staging Convex deployment URL
- One NodeSlide private-preview owner capability

Copy `.env.example` to `.env.local` and supply the two values. Never commit that file.

From the repository root:

```sh
pnpm install
pnpm --filter @parity/nodeslide-agent-client build
pnpm --filter @parity/eve-nodeslide-operator dev
```

## First proof

Ask the agent to inspect a known deck, revise one headline, and use deterministic execution. The
proposal must report `applied: false` and identical before/after deck versions. Review the proposal
summary, validation, digest, and base version before approving the gated `accept_proposal` call.

Do not add Slack, schedules, or subagents until this flow passes the client tests and a live staging
run without exposing credentials or changing the deck before approval.
