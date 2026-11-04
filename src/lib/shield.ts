/**
 * Listing shield: deterministic detection of text in merchant content that tries to
 * instruct an AI agent. Flagged text is removed before the model sees it.
 * This is a defence-in-depth layer; the policy firewall remains the hard guarantee.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(ai|llm|gpt|assistant|purchasing|shopping)\s+agents?\b/i, "addresses AI agents directly"],
  [/\b(system|developer)\s+(notice|message|prompt|instruction)s?\b/i, "impersonates a system message"],
  [/\bignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above)\b/i, "asks to ignore instructions"],
  [/\b(pre-?approved|already\s+approved|owner\s+(has\s+)?approved)\b/i, "claims owner approval"],
  [/\b(without\s+asking|do\s+not\s+ask|don'?t\s+ask|immediately\s+(buy|checkout|complete))\b/i, "demands action without consent"],
  [/\badd\s+\d+\s+(packs?|units?|cases?|items?)\b/i, "dictates quantities"],
  [/\b(complete|proceed\s+to)\s+checkout\b/i, "tries to trigger checkout"],
];

export interface ShieldResult {
  flagged: boolean;
  reasons: string[];
  /** Text safe to show the model. */
  sanitized: string;
}

export function scanListing(text: string): ShieldResult {
  const reasons = PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
  // Two or more independent signals, or an explicit system-message impersonation, is treated as an attack.
  const flagged = reasons.length >= 2 || reasons.includes("impersonates a system message");
  if (!flagged) return { flagged: false, reasons, sanitized: text };
  // Keep the factual prefix (before the injected payload) and drop the rest.
  const cut = text.search(/(important|system|note to|attention)\b/i);
  const keep = cut > 0 ? text.slice(0, cut).trim() : "";
  return { flagged: true, reasons, sanitized: `${keep} [Allowance removed text that tried to instruct AI agents]`.trim() };
}
