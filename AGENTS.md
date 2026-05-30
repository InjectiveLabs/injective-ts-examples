# AGENTS.md

Guidance for coding agents working in this repo.

## Repo Purpose

This repo is for runnable TypeScript examples that verify Injective SDK behavior
and endpoint responses. Keep examples small, direct, and easy to inspect.

## Workflow Rules

- Use `pnpm`; do not add Yarn or npm lockfiles.
- Preserve the current Injective dependency update workflow unless the user asks
  to change it. `pnpm deps:injective:update` is the explicit update command.
- Do not run the full `pnpm check` before confirming the code structure with the user.
- Keep a temporary tracking document under `/private/tmp/injective-ts-examples/`
  while doing multi-step work.
- Prefer focused validation while iterating:
  - `pnpm exec tsc --noEmit`
  - targeted `pnpm exec vitest run ...`
  - scoped `pnpm exec eslint ...`
  - `pnpm example list`
- Keep changes intended for review in one clear commit unless the user asks otherwise.

## Adding Examples

Add one `.ts` file under `src/examples/<category>/`.

The runner auto-discovers examples from `src/examples`, so do not manually add
new examples to a central list.

Do not add individual examples to the main `README.md`. Keep example-specific
documentation beside the example or in generated runner output.

Each example file must export:

- `metadata`: lightweight example metadata.
- `run`: the main async runner function.

Use this shape:

```ts
import type { ExampleMetadata } from "../types";
import { runDirectly } from "../../lib/direct-run";

export const metadata: ExampleMetadata = {
  id: "query:example-id",
  category: "queries",
  title: "Example title",
  description: "Short description shown by pnpm example list.",
  requiresEnvironment: ["PRIVATE_KEY"],
  mayBroadcast: false,
};

export const run = async (): Promise<void> => {
  const { SomeSdkClient } = await import("@injectivelabs/sdk-ts");

  // Example implementation.
};

runDirectly(module, run);
```

## Example Conventions

- Keep SDK-heavy imports inside `run` so `pnpm example list` stays fast and does
  not require env vars, endpoint access, or SDK initialization.
- Top-level imports should usually be limited to types and local lightweight
  helpers like `runDirectly`.
- Use ids with a category prefix, such as `query:spot-markets`,
  `tx:simulate-msg-send`, `authz:contract-execution`, or `cosmjs:send-tokens`.
- Use readable names. Avoid abbreviations in variables and functions.
- Use early returns for guard conditions.
- Use shared env helpers from `src/lib/env.ts`; do not cast unchecked
  `process.env` values.
- Keep root `.env.example` focused on shared variables. Do not pile every
  example-specific variable into it unless the variable is broadly reused.
- For private-key or transaction examples, default to simulation or no-op
  behavior. Require `BROADCAST_TRANSACTIONS=true` before broadcasting.
- Do not make live network calls from tests. Test the runner, registry,
  metadata, parsing, and env handling without touching endpoints.

## Verification Expectations

When adding or changing examples, add or update focused tests when practical.
At minimum, make sure:

- `pnpm example list` discovers the example.
- `pnpm exec tsc --noEmit` passes.
- Relevant runner/registry tests pass.
- Scoped lint passes for changed files.
