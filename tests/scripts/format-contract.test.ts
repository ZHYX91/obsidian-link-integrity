import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as formatSource from "../../scripts/check-format.mjs";

interface FormatModule {
  checkFormatting(projectRoot: string): Promise<number>;
}

const format = formatSource as unknown as FormatModule;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })),
  );
});

describe("format contract", () => {
  it("accepts LF text and canonical two-space JSON", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "source.ts"), "export const value = true;\n");
    await writeFile(path.join(root, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    await expect(format.checkFormatting(root)).resolves.toBe(2);
  });

  it("rejects trailing whitespace, CRLF, missing newlines, and non-canonical JSON", async () => {
    const root = await createWorkspace();
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "bad.ts"), "const bad = true; \r\n");
    await writeFile(path.join(root, "package.json"), "{\"name\":\"fixture\"}");
    await expect(format.checkFormatting(root)).rejects.toThrow(
      /line endings|trailing whitespace|2-space indentation/u,
    );
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "link-integrity-format-"));
  temporaryDirectories.push(root);
  return root;
}
