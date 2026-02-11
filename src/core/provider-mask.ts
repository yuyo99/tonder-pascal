/**
 * Provider name masking — 3-layer defense to prevent internal
 * acquirer/provider names from reaching merchants.
 *
 * Layer 1: Query-level grouping (in queries.ts)
 * Layer 2: Tool output sanitizer (this file — sanitizeToolOutput)
 * Layer 3: Final response audit (this file — auditResponse)
 */

/**
 * Map from internal acquirer/provider name → merchant-facing display name.
 * Used by getMerchantDisplayName() for translating acq values in tool output.
 *
 * NOTE: "tonder" is included here so getMerchantDisplayName("tonder") → "Cards",
 * but it is NOT in FORBIDDEN_NAMES, so the sanitizer won't blindly replace
 * "Tonder" (the company name) in Claude's prose with "Cards".
 */
export const MERCHANT_DISPLAY_NAMES: Record<string, string> = {
  // Card acquirers → merged under "Cards"
  kushki: "Cards",
  unlimit: "Cards",
  guardian: "Cards",
  tonder: "Cards",
  // SPEI providers → merged under "SPEI"
  bitso: "SPEI",
  stp: "SPEI",
  // Standalone APMs
  oxxopay: "Oxxopay",
  safetypay: "Cash Vouchers",
  mercadopago: "MercadoPago",
};

/**
 * Internal acquirer names that must never appear in merchant-facing output.
 * NOTE: "tonder" is intentionally excluded — it's the company name and appears
 * legitimately in prompts ("powered by Tonder"). The provider "tonder" is handled
 * at the query level where it's merged with guardian into Cards.
 */
export const FORBIDDEN_NAMES = [
  "kushki",
  "unlimit",
  "guardian",
  "bitso",
  "stp",
  "safetypay",
];

/** Get the merchant-facing display name for an acquirer */
export function getMerchantDisplayName(acq: string): string {
  const lower = acq.toLowerCase().trim();
  return MERCHANT_DISPLAY_NAMES[lower] || acq;
}

/**
 * Names safe to replace via regex in any text (tool output OR final response).
 * "tonder" is excluded because it's the company name — replacing it blindly
 * would turn "powered by Tonder" into "powered by Cards".
 */
const SANITIZE_SAFE_NAMES = Object.entries(MERCHANT_DISPLAY_NAMES).filter(
  ([key]) => key !== "tonder"
);

/**
 * Sanitize tool output before Claude sees it.
 * Replaces any raw provider/acquirer names with merchant-facing names.
 */
export function sanitizeToolOutput(output: string): string {
  let sanitized = output;
  for (const [internal, display] of SANITIZE_SAFE_NAMES) {
    const regex = new RegExp(`\\b${internal}\\b`, "gi");
    sanitized = sanitized.replace(regex, display);
  }
  return sanitized;
}

/**
 * Audit a final response for leaked provider names.
 * Returns list of forbidden names found (empty = safe).
 */
export function auditResponse(text: string): string[] {
  return FORBIDDEN_NAMES.filter((name) => {
    const regex = new RegExp(`\\b${name}\\b`, "i");
    return regex.test(text);
  });
}
