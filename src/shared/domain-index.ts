/** Immutable policy snapshot; lookup cost follows hostname depth, not list size. */
export function createDomainLookup(domains: readonly string[]): (host: string) => boolean {
  const entries = new Set(domains);
  return host => {
    let suffix = host;
    for (;;) {
      if (entries.has(suffix)) return true;
      const separator = suffix.indexOf('.');
      if (separator === -1) return false;
      suffix = suffix.slice(separator + 1);
    }
  };
}
