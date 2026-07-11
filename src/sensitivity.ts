export interface SensitivityResult {
  level: "normal" | "sensitive" | "secret";
  detectors: string[];
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ["credential_assignment", /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\b\s*[:=]\s*["']?[^\s"']{6,}/i],
  ["bearer_token", /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["github_token", /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["openai_key", /\bsk-[A-Za-z0-9_-]{20,}\b/]
];

const SENSITIVE_PATTERNS: Array<[string, RegExp]> = [
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ["phone", /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/],
  ["address_hint", /(?:住址|家庭地址|home address)\s*[:：]/i]
];

export function classifySensitivity(content: string): SensitivityResult {
  const secrets = SECRET_PATTERNS.filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
  if (secrets.length) return { level: "secret", detectors: secrets };
  const sensitive = SENSITIVE_PATTERNS.filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
  return sensitive.length ? { level: "sensitive", detectors: sensitive } : { level: "normal", detectors: [] };
}

export function redactSecrets(content: string): string {
  let redacted = content;
  for (const [name, pattern] of SECRET_PATTERNS) redacted = redacted.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`), `[REDACTED:${name}]`);
  return redacted;
}
