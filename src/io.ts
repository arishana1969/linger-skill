import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
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
