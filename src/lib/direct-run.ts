export type Runnable = () => Promise<void> | void;

const maxDetailDepth = 4;
const maxArrayItems = 20;
const maxObjectProperties = 40;
const maxStringLength = 2_000;
const sensitivePropertyPattern =
  /(api[-_]?key|authorization|mnemonic|password|private[-_]?key|secret|seed[-_]?phrase|token)/i;

const truncateString = (value: string): string => {
  if (value.length <= maxStringLength) {
    return value;
  }

  return `${value.slice(0, maxStringLength)}... [truncated ${value.length - maxStringLength} chars]`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const indent = (value: string): string =>
  value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const createFallbackStack = (reason: string): string | undefined => {
  const stack = new Error(reason).stack?.trim();

  return stack || undefined;
};

const getErrorStack = (error: Error): string => {
  const stack = error.stack?.trim();
  const fallbackStack = createFallbackStack(
    "Stack trace captured while formatting error",
  );

  if (stack?.includes("\n")) {
    return stack;
  }

  const header = stack || `${error.name}: ${error.message}`;

  if (!fallbackStack) {
    return header;
  }

  return [
    header,
    "",
    "Original error did not include stack frames. Captured formatter stack:",
    fallbackStack,
  ].join("\n");
};

const serializeDetail = (
  value: unknown,
  propertyName: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown => {
  if (propertyName && sensitivePropertyPattern.test(propertyName)) {
    return "[redacted]";
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }

  if (typeof value === "undefined") {
    return "[undefined]";
  }

  if (typeof value === "symbol") {
    return String(value);
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (!isRecord(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (depth >= maxDetailDepth) {
    return `[${value.constructor?.name || "Object"}]`;
  }

  seen.add(value);

  if (value instanceof Error) {
    const serializedError: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };

    if (value.stack) {
      serializedError.stack = truncateString(value.stack);
    }

    const ownProperties = Object.getOwnPropertyNames(value).filter(
      (ownProperty) =>
        !["name", "message", "stack", "cause"].includes(ownProperty),
    );

    for (const ownProperty of ownProperties.slice(0, maxObjectProperties)) {
      serializedError[ownProperty] = serializeDetail(
        value[ownProperty as keyof Error],
        ownProperty,
        depth + 1,
        seen,
      );
    }

    if (ownProperties.length > maxObjectProperties) {
      serializedError["[truncatedProperties]"] =
        ownProperties.length - maxObjectProperties;
    }

    seen.delete(value);

    return serializedError;
  }

  if (Array.isArray(value)) {
    const serializedArray = value
      .slice(0, maxArrayItems)
      .map((item) => serializeDetail(item, propertyName, depth + 1, seen));

    if (value.length > maxArrayItems) {
      serializedArray.push(`[truncated ${value.length - maxArrayItems} items]`);
    }

    seen.delete(value);

    return serializedArray;
  }

  const serializedObject: Record<string, unknown> = {};
  const ownProperties = Object.getOwnPropertyNames(value);

  for (const ownProperty of ownProperties.slice(0, maxObjectProperties)) {
    try {
      serializedObject[ownProperty] = serializeDetail(
        value[ownProperty],
        ownProperty,
        depth + 1,
        seen,
      );
    } catch (error) {
      serializedObject[ownProperty] =
        error instanceof Error
          ? `[Unable to read property: ${error.message}]`
          : "[Unable to read property]";
    }
  }

  if (ownProperties.length > maxObjectProperties) {
    serializedObject["[truncatedProperties]"] =
      ownProperties.length - maxObjectProperties;
  }

  seen.delete(value);

  return serializedObject;
};

const stringifyDetails = (details: unknown): string | undefined => {
  if (isRecord(details) && Object.keys(details).length === 0) {
    return undefined;
  }

  return JSON.stringify(details, null, 2);
};

const getErrorDetails = (
  error: Error,
  seen: WeakSet<object>,
): string | undefined => {
  const details: Record<string, unknown> = {};
  const ownProperties = Object.getOwnPropertyNames(error).filter(
    (ownProperty) =>
      !["name", "message", "stack", "cause"].includes(ownProperty),
  );

  for (const ownProperty of ownProperties) {
    details[ownProperty] = serializeDetail(
      error[ownProperty as keyof Error],
      ownProperty,
      0,
      seen,
    );
  }

  return stringifyDetails(details);
};

const formatErrorWithDetails = (
  error: unknown,
  seen: WeakSet<object>,
): string => {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return `[Circular ${error.name}: ${error.message}]`;
    }

    seen.add(error);

    const sections = [getErrorStack(error)];
    const details = getErrorDetails(error, seen);

    if (details) {
      sections.push(`Error details:\n${details}`);
    }

    if (error.cause !== undefined) {
      const formattedCause = formatErrorWithDetails(error.cause, seen);

      sections.push(`Caused by:\n${indent(formattedCause)}`);
    }

    seen.delete(error);

    return sections.join("\n");
  }

  if (typeof error === "string") {
    return error;
  }

  const details = stringifyDetails(serializeDetail(error, undefined, 0, seen));

  return details ? `Thrown value:\n${details}` : String(error);
};

export const formatError = (error: unknown): string => {
  return formatErrorWithDetails(error, new WeakSet<object>());
};

export const isDirectRun = (currentModule: NodeJS.Module): boolean =>
  require.main === currentModule;

export const runDirectly = (
  currentModule: NodeJS.Module,
  run: Runnable,
): void => {
  if (!isDirectRun(currentModule)) {
    return;
  }

  Promise.resolve(run()).catch((error: unknown) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
};
