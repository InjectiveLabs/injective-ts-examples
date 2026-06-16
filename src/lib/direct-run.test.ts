import { describe, expect, it } from "vitest";
import { formatError, runDirectly } from "./direct-run";

describe("direct-run helpers", () => {
  it("formats Error instances with stack traces", () => {
    const error = new Error("failed");
    error.stack = "Error: failed\n    at example.ts:1:1";

    expect(formatError(error)).toBe(error.stack);
  });

  it("captures a formatter stack when an Error has no stack frames", () => {
    const error = new Error("failed");
    error.stack = "Error: failed";

    expect(formatError(error)).toContain(
      "Original error did not include stack frames.",
    );
  });

  it("formats Error causes and extra properties", () => {
    const cause = new Error("node rejected tx");
    cause.stack = "Error: node rejected tx\n    at rpc.ts:1:1";
    const error = new Error("broadcast failed", { cause });
    error.stack = "Error: broadcast failed\n    at fee-grant.ts:1:1";
    Object.defineProperty(error, "code", {
      value: "TX_INVALID",
      enumerable: false,
    });

    const formattedError = formatError(error);

    expect(formattedError).toContain("Error: broadcast failed");
    expect(formattedError).toContain('"code": "TX_INVALID"');
    expect(formattedError).toContain("Caused by:");
    expect(formattedError).toContain("Error: node rejected tx");
  });

  it("redacts sensitive error detail properties", () => {
    const error = new Error("failed");
    error.stack = "Error: failed\n    at example.ts:1:1";
    Object.defineProperty(error, "privateKey", {
      value: "abc123",
      enumerable: false,
    });

    expect(formatError(error)).toContain('"privateKey": "[redacted]"');
  });

  it("formats non-error values", () => {
    expect(formatError("failed")).toBe("failed");
  });

  it("does not run when the module is imported", () => {
    let didRun = false;

    runDirectly({ id: "not-main" } as NodeJS.Module, () => {
      didRun = true;
    });

    expect(didRun).toBe(false);
  });
});
