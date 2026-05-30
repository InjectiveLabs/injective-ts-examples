import {
  discoverExamples,
  toRelativeExamplePath,
} from "./examples/registry";
import type { ExampleDefinition } from "./examples/types";
import { runDirectly } from "./lib/direct-run";

type Output = Pick<Console, "error" | "log">;

export type RunnerCommand =
  | { readonly type: "list" }
  | { readonly type: "help" }
  | { readonly type: "run"; readonly id: string };

export const parseRunnerArgs = (args: readonly string[]): RunnerCommand => {
  const [command] = args;

  if (!command || command === "list") {
    return { type: "list" };
  }

  if (command === "help" || command === "--help" || command === "-h") {
    return { type: "help" };
  }

  return { type: "run", id: command };
};

export const formatExampleList = (
  examples: readonly ExampleDefinition[]
): string => {
  if (examples.length === 0) {
    return "No examples found.";
  }

  const longestIdLength = Math.max(
    ...examples.map((example) => example.id.length)
  );
  const lines = examples.map((example) => {
    const environment = example.requiresEnvironment?.length
      ? ` env: ${example.requiresEnvironment.join(", ")}`
      : "";
    const broadcast = example.mayBroadcast ? " may broadcast with explicit flag" : "";

    return `  ${example.id.padEnd(longestIdLength)}  ${example.description}${environment}${broadcast}`;
  });

  return [
    "Available examples:",
    ...lines,
    "",
    "Run with: pnpm example <id>",
    "Direct run: pnpm exec tsx src/examples/<category>/<file>.ts",
  ].join("\n");
};

export const formatHelp = (examples: readonly ExampleDefinition[]): string =>
  [
    "Usage:",
    "  pnpm example list",
    "  pnpm example <id>",
    "",
    formatExampleList(examples),
  ].join("\n");

export const formatUnknownExample = (
  id: string,
  examples: readonly ExampleDefinition[]
): string => [`Unknown example "${id}".`, "", formatExampleList(examples)].join("\n");

export const runRunner = async (
  args: readonly string[],
  output: Output = console
): Promise<number> => {
  const command = parseRunnerArgs(args);
  const examples = await discoverExamples();

  if (command.type === "list") {
    output.log(formatExampleList(examples));
    return 0;
  }

  if (command.type === "help") {
    output.log(formatHelp(examples));
    return 0;
  }

  const example = examples.find((registeredExample) => {
    return registeredExample.id === command.id;
  });

  if (!example) {
    output.error(formatUnknownExample(command.id, examples));
    return 1;
  }

  output.log(`Running ${example.id}: ${example.title}`);
  output.log(`File: src/examples/${toRelativeExamplePath(example.filePath)}`);
  await example.run();
  return 0;
};

runDirectly(module, async () => {
  const exitCode = await runRunner(process.argv.slice(2));
  process.exitCode = exitCode;
});
