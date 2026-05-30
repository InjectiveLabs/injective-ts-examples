import { readdir } from "fs/promises";
import { extname, join, relative, sep } from "path";
import type { ExampleDefinition, ExampleMetadata, ExampleModule } from "./types";

const ignoredFileNames = new Set(["registry.ts", "types.ts"]);
const ignoredSuffixes = [".test.ts", ".spec.ts", ".d.ts"];

const defaultExamplesDirectory = __dirname;

const isExampleFile = (filePath: string): boolean => {
  const fileName = filePath.split(sep).at(-1);

  if (!fileName || ignoredFileNames.has(fileName)) {
    return false;
  }

  if (ignoredSuffixes.some((suffix) => fileName.endsWith(suffix))) {
    return false;
  }

  return extname(fileName) === ".ts";
};

const findExampleFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return findExampleFiles(entryPath);
      }

      return isExampleFile(entryPath) ? [entryPath] : [];
    })
  );

  return files.flat();
};

const isExampleMetadata = (value: unknown): value is ExampleMetadata => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ExampleMetadata>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.description === "string"
  );
};

const loadExampleModule = async (
  filePath: string
): Promise<ExampleDefinition> => {
  const exampleModule = (await import(filePath)) as Partial<ExampleModule>;

  if (!isExampleMetadata(exampleModule.metadata)) {
    throw new Error(
      `Example ${filePath} must export metadata with id, category, title, and description.`
    );
  }

  if (typeof exampleModule.run !== "function") {
    throw new Error(`Example ${filePath} must export a run function.`);
  }

  return {
    ...exampleModule.metadata,
    filePath,
    run: exampleModule.run,
  };
};

const sortExamples = (
  examples: readonly ExampleDefinition[]
): ExampleDefinition[] =>
  [...examples].sort((left, right) => {
    const categoryComparison = left.category.localeCompare(right.category);

    if (categoryComparison !== 0) {
      return categoryComparison;
    }

    return left.id.localeCompare(right.id);
  });

export const discoverExamples = async (
  examplesDirectory = defaultExamplesDirectory
): Promise<readonly ExampleDefinition[]> => {
  const filePaths = await findExampleFiles(examplesDirectory);
  const examples = await Promise.all(filePaths.map(loadExampleModule));
  const duplicateIds = examples
    .map((example) => example.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);

  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate example ids found: ${duplicateIds.join(", ")}.`);
  }

  return sortExamples(examples);
};

export const getExampleById = async (
  id: string,
  examplesDirectory = defaultExamplesDirectory
): Promise<ExampleDefinition | undefined> => {
  const examples = await discoverExamples(examplesDirectory);

  return examples.find((example) => example.id === id);
};

export const toRelativeExamplePath = (
  filePath: string,
  examplesDirectory = defaultExamplesDirectory
): string => relative(examplesDirectory, filePath).split(sep).join("/");
