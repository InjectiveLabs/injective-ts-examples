import { describe, expect, it } from "vitest";
import { formatError, runDirectly } from "./direct-run";

describe("direct-run helpers", () => {
  it("formats Error instances", () => {
    expect(formatError(new Error("failed"))).toBe("Error: failed");
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

