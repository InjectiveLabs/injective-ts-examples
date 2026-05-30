import { afterEach, describe, expect, it } from "vitest";
import {
  getBooleanEnvironmentVariable,
  getCsvEnvironmentVariable,
  getEnvironmentVariable,
  getNumberEnvironmentVariable,
  MissingEnvironmentVariableError,
  requireEnvironmentVariable,
} from "./env";

const testEnvironmentKeys = [
  "TEST_BOOLEAN",
  "TEST_CSV",
  "TEST_NUMBER",
  "TEST_OPTIONAL",
  "TEST_REQUIRED",
];

afterEach(() => {
  for (const key of testEnvironmentKeys) {
    delete process.env[key];
  }
});

describe("environment helpers", () => {
  it("returns default values for missing optional variables", () => {
    expect(getEnvironmentVariable("TEST_OPTIONAL", "fallback")).toBe("fallback");
  });

  it("throws a clear error for missing required variables", () => {
    expect(() => requireEnvironmentVariable("TEST_REQUIRED")).toThrow(
      MissingEnvironmentVariableError
    );
  });

  it("reads required variables and trims whitespace", () => {
    process.env.TEST_REQUIRED = " value ";

    expect(requireEnvironmentVariable("TEST_REQUIRED")).toBe("value");
  });

  it("parses boolean variables", () => {
    process.env.TEST_BOOLEAN = "yes";
    expect(getBooleanEnvironmentVariable("TEST_BOOLEAN")).toBe(true);

    process.env.TEST_BOOLEAN = "off";
    expect(getBooleanEnvironmentVariable("TEST_BOOLEAN", true)).toBe(false);
  });

  it("rejects invalid boolean variables", () => {
    process.env.TEST_BOOLEAN = "maybe";

    expect(() => getBooleanEnvironmentVariable("TEST_BOOLEAN")).toThrow(
      /Invalid boolean/
    );
  });

  it("parses number variables", () => {
    process.env.TEST_NUMBER = "42";

    expect(getNumberEnvironmentVariable("TEST_NUMBER", 0)).toBe(42);
  });

  it("parses csv variables", () => {
    process.env.TEST_CSV = "one, two,,three";

    expect(getCsvEnvironmentVariable("TEST_CSV", [])).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
});

