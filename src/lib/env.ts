import { config } from "dotenv";

let environmentLoaded = false;

const trueValues = new Set(["1", "true", "yes", "y", "on"]);
const falseValues = new Set(["0", "false", "no", "n", "off"]);

export class MissingEnvironmentVariableError extends Error {
  constructor(name: string) {
    super(
      `Missing required environment variable ${name}. Add it to .env or export it before running this example.`
    );
    this.name = "MissingEnvironmentVariableError";
  }
}

export const loadEnvironment = (): void => {
  if (environmentLoaded) {
    return;
  }

  config();
  environmentLoaded = true;
};

export function getEnvironmentVariable(name: string): string | undefined;
export function getEnvironmentVariable(name: string, defaultValue: string): string;
export function getEnvironmentVariable(
  name: string,
  defaultValue?: string
): string | undefined {
  loadEnvironment();

  const value = process.env[name]?.trim();

  if (!value) {
    return defaultValue;
  }

  return value;
}

export const requireEnvironmentVariable = (name: string): string => {
  const value = getEnvironmentVariable(name);

  if (!value) {
    throw new MissingEnvironmentVariableError(name);
  }

  return value;
};

export const getBooleanEnvironmentVariable = (
  name: string,
  defaultValue = false
): boolean => {
  const value = getEnvironmentVariable(name);

  if (value === undefined) {
    return defaultValue;
  }

  const normalizedValue = value.toLowerCase();

  if (trueValues.has(normalizedValue)) {
    return true;
  }

  if (falseValues.has(normalizedValue)) {
    return false;
  }

  throw new Error(
    `Invalid boolean environment variable ${name}: expected true/false, got "${value}".`
  );
};

export const getNumberEnvironmentVariable = (
  name: string,
  defaultValue: number
): number => {
  const value = getEnvironmentVariable(name);

  if (value === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(
      `Invalid number environment variable ${name}: expected a number, got "${value}".`
    );
  }

  return parsedValue;
};

export const getCsvEnvironmentVariable = (
  name: string,
  defaultValues: readonly string[]
): string[] => {
  const value = getEnvironmentVariable(name);

  if (value === undefined) {
    return [...defaultValues];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const getEnumEnvironmentVariable = <EnumValue extends string>(
  name: string,
  defaultValue: EnumValue,
  allowedValues: readonly EnumValue[]
): EnumValue => {
  const value = getEnvironmentVariable(name);

  if (value === undefined) {
    return defaultValue;
  }

  const matchingValue = allowedValues.find(
    (allowedValue) => allowedValue.toLowerCase() === value.toLowerCase()
  );

  if (!matchingValue) {
    throw new Error(
      `Invalid value "${value}" in ${name}. Use one of: ${allowedValues.join(
        ", "
      )}.`
    );
  }

  return matchingValue;
};
