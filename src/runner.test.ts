import { describe, expect, it, vi } from "vitest";
import { discoverExamples } from "./examples/registry";
import {
  formatExampleList,
  formatUnknownExample,
  parseRunnerArgs,
  runRunner,
} from "./runner";

describe("runner", () => {
  it("parses empty args as list", () => {
    expect(parseRunnerArgs([])).toEqual({ type: "list" });
  });

  it("parses help flags", () => {
    expect(parseRunnerArgs(["--help"])).toEqual({ type: "help" });
    expect(parseRunnerArgs(["-h"])).toEqual({ type: "help" });
    expect(parseRunnerArgs(["help"])).toEqual({ type: "help" });
  });

  it("parses an example id as a run command", () => {
    expect(parseRunnerArgs(["query:spot-markets"])).toEqual({
      type: "run",
      id: "query:spot-markets",
    });
  });

  it("formats the example list without running any examples", async () => {
    const output = {
      error: vi.fn(),
      log: vi.fn(),
    };

    const exitCode = await runRunner(["list"], output);

    expect(exitCode).toBe(0);
    expect(output.error).not.toHaveBeenCalled();
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("Available examples:")
    );
  });

  it("returns an error for unknown examples", async () => {
    const output = {
      error: vi.fn(),
      log: vi.fn(),
    };

    const exitCode = await runRunner(["missing:example"], output);

    expect(exitCode).toBe(1);
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown example "missing:example".')
    );
  });

  it("includes direct-run guidance in list output", async () => {
    const examples = await discoverExamples();

    expect(formatExampleList(examples)).toContain("pnpm exec tsx");
    expect(formatUnknownExample("missing:example", examples)).toContain(
      "Available examples:"
    );
  });
});

