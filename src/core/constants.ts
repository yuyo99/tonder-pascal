/**
 * Shared constants for Pascal's core logic.
 *
 * These don't fit cleanly inside a single feature module but are
 * referenced from multiple places (prompts, rules, response routing).
 */

/**
 * Non-Tonder payment processors that merchants sometimes confuse with us.
 *
 * When a merchant shares a comprobante (payment receipt) or a screenshot
 * naming one of these as the receiving PSP, the transaction was NEVER
 * processed through Tonder — searching our records will never find it.
 *
 * Used by:
 *   - The generator system prompt (src/core/prompts.ts), which instructs
 *     Pascal to short-circuit BEFORE calling lookup_by_id when one of
 *     these names appears in the user's message.
 *
 * Source: PASCAL.pdf Caso 9 (2026-06-04) — BCGAME submitted a ticket
 * with a FINCO PAY voucher; the comprobante belonged to a different PSP.
 *
 * Match strategy: substring, case-insensitive. Keep the list short and
 * specific — vague matches risk false positives on transaction memos
 * or descriptions.
 */
export const NON_TONDER_PROCESSORS = [
  "FINCO PAY",
  "FINCOPAY",
  "CONEKTA",
  "OPENPAY",
  "STRIPE",
  "CULQI",
  "BANWIRE",
  "PAYPAL",
  "MERCADO PAGO BR", // careful: we DO process MercadoPago MX via the mercadopago acq.
] as const;

export type NonTonderProcessor = (typeof NON_TONDER_PROCESSORS)[number];
