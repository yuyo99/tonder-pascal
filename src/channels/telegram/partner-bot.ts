import { logger } from "../../utils/logger";

export interface ParsedDepositTicket {
  orderId: string;
  txid: string;
  currency: string;
  amount: string;
}

/**
 * Parse a structured deposit ticket message from a partner bot.
 * Expected format:
 *   orderId: <value>
 *   txid: <value>
 *   currency: <value>
 *   amount: <value>
 *
 *   We have a new deposit ticket...
 *
 * Returns null if orderId or txid lines are missing.
 */
export function parseDepositTicket(text: string): ParsedDepositTicket | null {
  const orderIdMatch = text.match(/orderId:\s*(.+)/i);
  const txidMatch = text.match(/txid:\s*(.+)/i);
  const currencyMatch = text.match(/currency:\s*(.+)/i);
  const amountMatch = text.match(/amount:\s*(.+)/i);

  if (!orderIdMatch || !txidMatch) {
    logger.debug(
      { text: text.slice(0, 100) },
      "Partner bot message does not match deposit ticket format"
    );
    return null;
  }

  return {
    orderId: orderIdMatch[1].trim(),
    txid: txidMatch[1].trim(),
    currency: currencyMatch ? currencyMatch[1].trim() : "unknown",
    amount: amountMatch ? amountMatch[1].trim() : "unknown",
  };
}

/**
 * Validate the txid field from a parsed deposit ticket.
 * Returns true only if txid is non-empty and alphanumeric.
 */
export function isValidTxid(txid: string): boolean {
  if (!txid || txid.trim() === "") return false;
  return /^[a-zA-Z0-9]+$/.test(txid.trim());
}

/**
 * Build a tightly scoped message for the orchestrator to look up a deposit ticket.
 * Claude will use lookup_by_id with the orderId and respond concisely.
 */
export function buildTicketLookupPrompt(ticket: ParsedDepositTicket): string {
  return [
    `[AUTOMATED DEPOSIT TICKET LOOKUP]`,
    `A partner bot has reported a new deposit ticket. Look up the order using the orderId below.`,
    ``,
    `Order ID (maps to order_id in Tonder): ${ticket.orderId}`,
    `TXID (maps to payment_id in Tonder): ${ticket.txid}`,
    `Currency: ${ticket.currency}`,
    `Amount: ${ticket.amount}`,
    ``,
    `Use the lookup_by_id tool with the Order ID "${ticket.orderId}" to find the transaction.`,
    `If not found by Order ID, try again with the TXID "${ticket.txid}" (which is the payment_id).`,
    `If found: reply with the transaction status, amount, and date. Keep it to 2-3 lines max.`,
    `If NOT found: reply ONLY with "Order ID ${ticket.orderId} not found." — nothing else. No next steps, no suggestions, no explanations. Just that one line.`,
  ].join("\n");
}
