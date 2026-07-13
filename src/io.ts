import { lstat, mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function atomicWrite(file: string, data: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  await writeFile(tmp, data, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(tmp, file);
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function assertReadableInside(root: string, target: string): Promise<void> {
  const rootResolved = path.resolve(root);
  const targetResolved = path.resolve(target);
  const lexical = path.relative(rootResolved, targetResolved);
  if (!lexical || lexical.startsWith("..") || path.isAbsolute(lexical)) throw new Error("Read path escapes Vault");
  const [rootReal, targetReal] = await Promise.all([realpath(rootResolved), realpath(targetResolved)]);
  const physical = path.relative(rootReal, targetReal);
  if (!physical || physical.startsWith("..") || path.isAbsolute(physical)) throw new Error("Read path escapes Vault through symlink");
  if ((await lstat(targetResolved)).isSymbolicLink()) throw new Error("Read target is a symlink");
}

export async function assertWritableInside(root: string, target: string): Promise<void> {
  const rootResolved = path.resolve(root);
  const targetResolved = path.resolve(target);
  const lexical = path.relative(rootResolved, targetResolved);
  if (!lexical || lexical.startsWith("..") || path.isAbsolute(lexical)) throw new Error("Write path escapes Vault");
  const rootReal = await realpath(rootResolved);
  let ancestor = path.dirname(targetResolved);
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const physical = path.relative(rootReal, ancestor);
  if (physical.startsWith("..") || path.isAbsolute(physical)) throw new Error("Write path escapes Vault through symlink");
  try { if ((await lstat(targetResolved)).isSymbolicLink()) throw new Error("Write target is a symlink"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export async function withFileLock<T>(lockFile: string, action: () => Promise<T>): Promise<T> {
  await ensureDir(path.dirname(lockFile));
  let handle;
  try {
    handle = await open(lockFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Vault is busy: ${lockFile}`);
    throw error;
  }
  try {
    return await action();
  } finally {
    await handle.close();
    const { unlink } = await import("node:fs/promises");
    await unlink(lockFile).catch(() => undefined);
  }
}
