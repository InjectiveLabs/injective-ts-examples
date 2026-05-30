export type Runnable = () => Promise<void> | void;

export const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
};

export const isDirectRun = (currentModule: NodeJS.Module): boolean =>
  require.main === currentModule;

export const runDirectly = (
  currentModule: NodeJS.Module,
  run: Runnable
): void => {
  if (!isDirectRun(currentModule)) {
    return;
  }

  Promise.resolve(run()).catch((error: unknown) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
};

