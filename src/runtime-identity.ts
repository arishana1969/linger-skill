import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assertReadableInside } from "./io.js";

export async function runtimeFingerprint(packageRoot: string, node: string): Promise<string> {
  const root = path.resolve(packageRoot);
  await assertReadableInside(root, path.join(root, "dist"));
  const files = await runtimeFiles(path.join(root, "dist"));
  const hook = path.resolve(root, "dist", "hook-cli.js");
  if (!files.some(file => path.resolve(file) === hook)) throw new Error("Linger runtime is missing dist/hook-cli.js");
  const hash = createHash("sha256").update(root).update("\0").update(path.resolve(node));
  for (const file of files) {
    await assertReadableInside(root, file);
    hash.update("\0").update(path.relative(root, file)).update("\0").update(await readFile(file));
  }
  return hash.digest("hex");
}

async function runtimeFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await runtimeFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files.sort();
}
