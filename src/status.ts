import os from "node:os";
import { healthReport } from "./lifecycle-evidence.js";
import { localEmbeddingStatus } from "./local/local-embedding.js";
import { sessionControlStatus } from "./session-control.js";
import { projectId, vaultStats } from "./vault.js";

export interface StatusOptions {
  cwd?: string;
  projectId?: string;
  home?: string;
  sessionToken?: string;
}

export async function lingerStatus(root: string, options: StatusOptions = {}): Promise<Record<string, unknown>> {
  const project = options.projectId ?? await projectId(options.cwd ?? process.cwd(), root);
  const [stats, health, embedding, session] = await Promise.all([
    vaultStats(root, project),
    healthReport(root, { projectId: project, home: options.home ?? os.homedir() }),
    localEmbeddingStatus(root, project),
    options.sessionToken ? sessionControlStatus(root, options.sessionToken) : undefined
  ]);
  return {
    ...stats,
    capture: {
      global: stats.paused ? "off" : "on",
      session: session?.capture ?? "unknown"
    },
    health,
    embedding,
    ...(session ? { session } : {})
  };
}
