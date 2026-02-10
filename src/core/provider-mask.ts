/**
 * Provider name masking — 3-layer defense to prevent internal
 * acquirer/provider names from reaching merchants.
 *
 * Layer 1: Query-level grouping (in queries.ts)
 * Layer 2: Tool output sanitizer (this file — sanitizeToolOutput)
 * Layer 3: Final response audit (this file — auditResponse)
 */

/** Map from internal acquirer name → merchant-facing display name */
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

/** Internal acquirer names that must never appear in merchant-facing output */
export const FORBIDDEN_NAMES = [
  "kushki",
  "unlimit",
  "guardian",
  "bitso",
  "stp",
  "safetypay",
  "tonder",
];

/** Get the merchant-facing display name for an acquirer */
export function getMerchantDisplayName(acq: string): string {
  const lower = acq.toLowerCase().trim();
  return MERCHANT_DISPLAY_NAMES[lower] || acq;
}

/**
 * Sanitize tool output before Claude sees it.
 * Replaces any raw provider/acquirer names with merchant-facing names.
 */
export function sanitizeToolOutput(output: string): string {
  let sanitized = output;
  for (const [internal, display] of Object.entries(MERCHANT_DISPLAY_NAMES)) {
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
