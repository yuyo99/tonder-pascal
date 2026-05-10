/**
 * PDF Refund Receipt Generator using PDFKit.
 * Clean, light-mode design with Tonder branding.
 */

import PDFDocument from "pdfkit";

const BRAND = "#0d9488";       // Tonder teal
const BRAND_LIGHT = "#f0fdfa"; // Very light teal bg
const TEXT_PRIMARY = "#1f2937"; // Near-black
const TEXT_SECONDARY = "#6b7280"; // Gray-500
const TEXT_MUTED = "#9ca3af";   // Gray-400
const BORDER = "#e5e7eb";      // Gray-200
const WHITE = "#ffffff";

// Company domain shown in the PDF footer. Override via COMPANY_DOMAIN env var
// during domain migrations (e.g. tonder.io → paymentslab.ai) without code changes.
const COMPANY_DOMAIN = process.env.COMPANY_DOMAIN ?? "paymentslab.ai";

// Tonder logo embedded as base64 PNG (works in all environments, no file path needed)
const LOGO_BASE64 = "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";
const LOGO_BUFFER = Buffer.from(LOGO_BASE64, "base64");

export interface ReceiptData {
  paymentId: string;
  orderId?: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod?: string;
  customerEmail?: string;
  merchantName: string;
  createdAt: string;
}

function fmt(amount: number, currency: string): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function fmtDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "America/Mexico_City",
    });
  } catch {
    return dateStr;
  }
}

export async function generateRefundReceipt(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [420, 560],
        margins: { top: 44, bottom: 44, left: 44, right: 44 },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const W = 420;
      const cw = W - 88;
      const L = 44;
      let y = 44;

      // ── Page background ──
      doc.rect(0, 0, W, 560).fill(WHITE);

      // ── Header: logo + receipt label ──
      try {
        doc.image(LOGO_BUFFER, L, y, { width: 90 });
      } catch {
        doc.fontSize(18).fillColor(BRAND).font("Helvetica-Bold").text("tonder", L, y);
      }

      doc.fontSize(10).fillColor(TEXT_MUTED).font("Helvetica");
      doc.text("Recibo de Reembolso", L, y + 4, { width: cw, align: "right" });
      doc.fontSize(8).fillColor(TEXT_MUTED);
      doc.text(fmtDate(new Date().toISOString()), L, y + 18, { width: cw, align: "right" });

      y += 56;

      // ── Thin separator ──
      doc.moveTo(L, y).lineTo(L + cw, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 24;

      // ── Amount block ──
      doc.roundedRect(L, y, cw, 72, 8).fillAndStroke(BRAND_LIGHT, BORDER);

      doc.fontSize(9).fillColor(TEXT_SECONDARY).font("Helvetica");
      doc.text("Monto Reembolsado", L + 20, y + 16);

      doc.fontSize(28).fillColor(TEXT_PRIMARY).font("Helvetica-Bold");
      doc.text(fmt(data.amount, data.currency), L + 20, y + 34);

      y += 92;

      // ── Details section ──
      doc.fontSize(8).fillColor(TEXT_MUTED).font("Helvetica-Bold");
      doc.text("DETALLES", L, y);
      y += 16;

      const row = (label: string, value: string) => {
        doc.fontSize(9).fillColor(TEXT_SECONDARY).font("Helvetica");
        doc.text(label, L, y);
        doc.fontSize(9).fillColor(TEXT_PRIMARY).font("Helvetica-Bold");
        doc.text(value, L + 120, y, { width: cw - 120 });
        y += 20;
      };

      row("Referencia", data.paymentId);
      if (data.orderId) row("ID de Orden", data.orderId);
      row("Fecha", fmtDate(data.createdAt));
      row("Estatus", data.status);
      if (data.paymentMethod) row("Método de Pago", data.paymentMethod);
      if (data.customerEmail) row("Cliente", data.customerEmail);
      row("Comercio", data.merchantName);

      y += 8;
      doc.moveTo(L, y).lineTo(L + cw, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 20;

      // ── Footer note ──
      doc.fontSize(8).fillColor(TEXT_MUTED).font("Helvetica");
      doc.text(
        "Este recibo confirma que tu reembolso ha sido procesado por Tonder. " +
        "El monto se verá reflejado en tu cuenta en un plazo de 5 a 20 días hábiles. " +
        "Si después de este periodo no lo ves reflejado, te recomendamos contactar a tu banco emisor.",
        L, y, { width: cw, lineGap: 3 }
      );

      // ── Bottom branding ──
      doc.fontSize(7).fillColor(TEXT_MUTED).font("Helvetica");
      doc.text(COMPANY_DOMAIN, L, 530, { width: cw, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
