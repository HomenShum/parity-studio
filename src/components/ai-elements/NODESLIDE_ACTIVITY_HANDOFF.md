# NodeSlide activity-stream AI Elements handoff

Decision (2026-07-14): defer the runtime Conversation/Message/Tool/Sources/Task wrapper pass. The official shells are individually usable, but applying them to the current `AiInspector` activity stream would require scroll and data-contract changes beyond the composer lane.

## Why this is deferred

- `Conversation` owns stick-to-bottom scrolling. NodeSlide's current `ns-ai-v3-review-scroll` is also the review surface for progress, proposals, previews, and generated directions. Wrapping that entire surface would pull a reviewer away from a proposal whenever activity updates.
- `NodeSlideAgentMessage` has `toolName` and text, but no AI SDK tool state, input, output, denial, or error fields. Do not infer `output-available` merely because a tool message was persisted.
- Messages expose `sourceIds`, but `AiInspector` does not receive the source title/URL records required by `Source`. Do not manufacture links from IDs.
- `AgentTrace.plan` exposes step text, but not stable per-step pending/running/completed/error state. `Task` can be adopted once that UI state is supplied without changing the proposal contract.
- The generated `Message` module imports the Streamdown plugin stack even if NodeSlide uses only `Message` and `MessageContent`. That dependency and CSS expansion should be evaluated with the activity redesign, not coupled to the composer gate.

## Adapter boundary for the integrator

Add a UI-only `NodeSlideActivityElements` adapter beside `AiInspector.tsx`. It should receive resolved presentation data rather than editing shared backend types from this lane:

```ts
interface NodeSlideActivityElementsProps {
  messages: readonly NodeSlideAgentMessage[];
  toolsByMessageId: ReadonlyMap<
    string,
    {
      state:
        | 'input-streaming'
        | 'input-available'
        | 'approval-requested'
        | 'approval-responded'
        | 'output-available'
        | 'output-error'
        | 'output-denied';
      input?: unknown;
      output?: unknown;
      errorText?: string;
    }
  >;
  sourcesById: ReadonlyMap<string, { title: string; url: string }>;
  planSteps: readonly {
    id: string;
    label: string;
    state: 'pending' | 'running' | 'completed' | 'error';
  }[];
}
```

If those resolved maps are not already available in the Studio query layer, the integrator must coordinate the shared data change. `AiInspector` should not guess them.

## Intended component mapping

1. Keep `ns-ai-v3-review-scroll` as the outer review-scroll owner. Add `Conversation` only around the persisted/optimistic message lane, with an explicit pause while a proposal or direction is being reviewed.
2. Map user messages to `Message from="user"`; map assistant/system copy to `Message from="assistant"`. Preserve `agent-message-*` and `optimistic-user-ask` test IDs on the outer shell.
3. Render tool messages with `Tool type="dynamic-tool"`, the real resolved state, and `toolName`. Put existing human-readable content in `ToolOutput`; never expose raw provider secrets in `ToolInput`.
4. Resolve every `sourceId` before rendering `Sources` / `SourcesTrigger` / `Source`. Keep the current persisted-snapshot wording when a record is unavailable.
5. Replace only the expandable plan body with `Task` / `TaskContent` / `TaskItem`. Keep cancellation, delayed/failed honesty states, `aria-live`, and proposal-before-mutate controls outside that shell.

## Official generated-source additions

- `conversation` → `use-stick-to-bottom` plus the existing Button primitive.
- `message` → `streamdown`, `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid`, Button Group, and Tooltip.
- `tool` → Badge, Collapsible, and Code Block.
- `sources` and `task` → Collapsible.

Registry/docs: [Conversation](https://elements.ai-sdk.dev/components/conversation), [Message](https://elements.ai-sdk.dev/components/message), [Tool](https://elements.ai-sdk.dev/components/tool), [Sources](https://elements.ai-sdk.dev/components/sources), and [Task](https://elements.ai-sdk.dev/components/task).

## Required gates before adoption

- A new incoming activity event must not move scroll while a proposal/direction is under review.
- Existing `agent-message-*`, `optimistic-user-ask`, `ai-cancel-run`, proposal, and direction interaction tests must remain intact.
- Tool status, source links, and task status must be backed by resolved records, not presentation guesses.
- Light/dark token and Radix portal checks must run inside `.nodeslide-studio`.
- Composer model, effort, attachment, Enter/Shift+Enter, and AI→Trace→AI persistence tests must remain green unchanged.
