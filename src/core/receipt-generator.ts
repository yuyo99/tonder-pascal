/**
 * PDF Refund Receipt Generator using PDFKit.
 * Clean, light-mode design with Tonder branding.
 */

import PDFDocument from "pdfkit";
import path from "path";

const BRAND = "#0d9488";       // Tonder teal
const BRAND_LIGHT = "#f0fdfa"; // Very light teal bg
const TEXT_PRIMARY = "#1f2937"; // Near-black
const TEXT_SECONDARY = "#6b7280"; // Gray-500
const TEXT_MUTED = "#9ca3af";   // Gray-400
const BORDER = "#e5e7eb";      // Gray-200
const WHITE = "#ffffff";

const LOGO_PATH = path.join(__dirname, "..", "assets", "tonder-logo.png");

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
        doc.image(LOGO_PATH, L, y, { width: 90 });
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
      doc.text("tonder.io", L, 530, { width: cw, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
