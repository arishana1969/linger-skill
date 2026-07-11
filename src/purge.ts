import { rm } from "node:fs/promises";
import path from "node:path";
import { uninstall } from "./installer.js";

export async function purge(home: string, confirmation: { yes: boolean; phrase: string }): Promise<{ purged: true; root: string }> {
  if (!confirmation.yes || confirmation.phrase !== "PURGE") throw new Error("Purge requires --yes and --confirm PURGE");
  const resolvedHome = path.resolve(home);
  const root = path.join(resolvedHome, ".continuity");
  const relative = path.relative(resolvedHome, root);
  if (relative !== ".continuity") throw new Error("Unsafe purge target");
  await uninstall(resolvedHome);
  await rm(root, { recursive: true, force: true });
  return { purged: true, root };
}
