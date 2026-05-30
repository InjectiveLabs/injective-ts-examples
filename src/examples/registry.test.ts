import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverExamples,
  getExampleById,
  toRelativeExamplePath,
} from "./registry";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "injective-example-test-"));
  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => {
      return rm(directory, { recursive: true, force: true });
    })
  );
});

describe("example registry", () => {
  it("contains unique discovered example ids", async () => {
    const examples = await discoverExamples();
    const ids = examples.map((example) => example.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it("can find every discovered example by id", async () => {
    const examples = await discoverExamples();

    for (const example of examples) {
      expect(await getExampleById(example.id)).toEqual(example);
    }
  });

  it("keeps discovered examples usable by the runner", async () => {
    const examples = await discoverExamples();

    expect(examples.length).toBeGreaterThan(0);

    for (const example of examples) {
      expect(example.id).toContain(":");
      expect(example.description.length).toBeGreaterThan(0);
      expect(example.title.length).toBeGreaterThan(0);
      expect(example.filePath.endsWith(".ts")).toBe(true);
    }
  });

  it("auto-discovers a new example file without a registry edit", async () => {
    const examplesDirectory = await createTemporaryDirectory();
    const categoryDirectory = join(examplesDirectory, "queries");

    await mkdir(categoryDirectory);
    await writeFile(
      join(categoryDirectory, "temporary-example.ts"),
      [
        'export const metadata = {',
        '  id: "query:temporary",',
        '  category: "queries",',
        '  title: "Temporary example",',
        '  description: "Used by registry discovery tests."',
        "};",
        "export const run = async () => {};",
      ].join("\n")
    );

    const examples = await discoverExamples(examplesDirectory);

    expect(examples.map((example) => example.id)).toEqual(["query:temporary"]);
  });

  it("formats relative example paths", async () => {
    const examples = await discoverExamples();
    const [firstExample] = examples;

    expect(firstExample).toBeDefined();
    expect(toRelativeExamplePath(firstExample.filePath)).not.toContain("src/");
  });
});
