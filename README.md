# Injective TypeScript Examples

TypeScript examples for checking Injective SDK behavior and endpoint responses.

The repo is intentionally small: examples can be run by name through a typed
runner, or directly as TypeScript files when you want to inspect and tweak one
case.

## Requirements

- Node.js
- pnpm 10.7.0

## Setup

```bash
pnpm install
cp .env.example .env
```

`PRIVATE_KEY` is only required for examples that build transactions. Transaction
examples default to simulation or no-op behavior. Set
`BROADCAST_TRANSACTIONS=true` only when you explicitly want an example to
broadcast.

## Run Examples

List available examples:

```bash
pnpm example list
```

Run an example by id:

```bash
pnpm example query:spot-markets
pnpm example tx:simulate-msg-send
```

Run a file directly:

```bash
pnpm exec tsx src/examples/queries/spot-markets.ts
```

## Add Examples

Add a `.ts` file under `src/examples/<category>/`. The runner auto-discovers
example files, so no registry edit is needed.

Each example should export lightweight `metadata` and a `run` function:

```ts
import type { ExampleMetadata } from "../types";
import { runDirectly } from "../../lib/direct-run";

export const metadata: ExampleMetadata = {
  id: "query:example-id",
  category: "queries",
  title: "Example title",
  description: "Short description shown by pnpm example list.",
};

export const run = async (): Promise<void> => {
  const { SomeSdkClient } = await import("@injectivelabs/sdk-ts");

  // Example implementation.
};

runDirectly(module, run);
```

Keep SDK-heavy imports inside `run` so `pnpm example list` can import metadata
without initializing clients or requiring environment variables.

## Example Configuration

Common environment variables:

- `INJECTIVE_NETWORK`: network name accepted by `@injectivelabs/networks`.
- `INJECTIVE_RPC_ENDPOINT`: overrides the RPC endpoint for RPC/CosmJS examples.
- `PRIVATE_KEY`: shared hex private key for transaction examples.
- `SEED_PHRASE`: shared mnemonic used by examples that accept mnemonic signing.
- `DESTINATION_INJECTIVE_ADDRESS`: recipient address for send examples. Some
  examples default to the source account when unset.
- `SEND_AMOUNT_INJ`: optional amount override for examples that send a fixed
  amount.
- `BROADCAST_TRANSACTIONS`: must be `true` before any broadcast-capable example
  sends a transaction.

## Scripts

```bash
pnpm example <id>
pnpm example:list
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm deps:injective:update
```

`pnpm deps:injective:update` updates `@injectivelabs/*` packages explicitly.
It is not part of `postinstall`, so normal installs remain reproducible.

## License

Apache-2.0
