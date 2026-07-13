export function isExplicitMemoryRequest(content: string): boolean {
  return /(?:记一下|记住|保存这个|remember this)/i.test(content);
}
