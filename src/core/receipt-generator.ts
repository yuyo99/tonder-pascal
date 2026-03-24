/**
 * PDF Refund Receipt Generator using PDFKit.
 * Produces a clean, branded receipt with the Tonder logo.
 */

import PDFDocument from "pdfkit";
import path from "path";

// Tonder brand blue (from logo)
const BRAND_BLUE = "#1a3b5c";
const LIGHT_BLUE = "#e8f0f8";
const GRAY_600 = "#525252";
const GRAY_400 = "#a3a3a3";
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

function formatAmount(amount: number, currency: string): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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
        size: [420, 595], // Slightly narrower than A4 for receipt feel
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = 420;
      const contentWidth = pageWidth - 80; // margins
      const leftMargin = 40;
      let y = 40;

      // ── Header bar ──
      doc.rect(0, 0, pageWidth, 90).fill(BRAND_BLUE);

      // Logo (white area)
      try {
        doc.image(LOGO_PATH, leftMargin, 20, { width: 100 });
      } catch {
        // Fallback: text logo if image fails
        doc.fontSize(20).fillColor(WHITE).font("Helvetica-Bold").text("tonder", leftMargin, 30);
      }

      // Receipt title on right
      doc.fontSize(18).fillColor(WHITE).font("Helvetica-Bold");
      doc.text("REFUND RECEIPT", leftMargin, 35, { width: contentWidth, align: "right" });
      doc.fontSize(9).fillColor("#a0c4e8").font("Helvetica");
      doc.text(formatDate(new Date().toISOString()), leftMargin, 58, { width: contentWidth, align: "right" });

      y = 110;

      // ── Amount section ──
      doc.rect(leftMargin, y, contentWidth, 70).lineWidth(1).strokeColor("#e0e0e0").fillAndStroke(LIGHT_BLUE, "#e0e0e0");

      doc.fontSize(10).fillColor(GRAY_400).font("Helvetica");
      doc.text("Amount Refunded", leftMargin + 20, y + 15);

      doc.fontSize(26).fillColor(BRAND_BLUE).font("Helvetica-Bold");
      doc.text(formatAmount(data.amount, data.currency), leftMargin + 20, y + 32);

      y += 90;

      // ── Transaction Details ──
      doc.fontSize(10).fillColor(BRAND_BLUE).font("Helvetica-Bold");
      doc.text("TRANSACTION DETAILS", leftMargin, y);
      y += 6;
      doc.moveTo(leftMargin, y + 10).lineTo(leftMargin + contentWidth, y + 10).strokeColor("#e0e0e0").lineWidth(1).stroke();
      y += 20;

      const drawRow = (label: string, value: string) => {
        doc.fontSize(9).fillColor(GRAY_400).font("Helvetica");
        doc.text(label, leftMargin, y, { width: 130 });
        doc.fontSize(10).fillColor(GRAY_600).font("Helvetica-Bold");
        doc.text(value, leftMargin + 140, y, { width: contentWidth - 140 });
        y += 22;
      };

      drawRow("Transaction ID", data.paymentId);
      if (data.orderId) drawRow("Order ID", data.orderId);
      drawRow("Date", formatDate(data.createdAt));
      drawRow("Status", data.status);
      if (data.paymentMethod) drawRow("Payment Method", data.paymentMethod);
      if (data.customerEmail) drawRow("Customer", data.customerEmail);
      drawRow("Merchant", data.merchantName);

      y += 10;
      doc.moveTo(leftMargin, y).lineTo(leftMargin + contentWidth, y).strokeColor("#e0e0e0").lineWidth(1).stroke();
      y += 25;

      // ── Footer note ──
      doc.fontSize(9).fillColor(GRAY_400).font("Helvetica");
      doc.text(
        "This receipt confirms the refund has been processed by Tonder. " +
        "Please allow 5-10 business days for the refund to appear in your account.",
        leftMargin,
        y,
        { width: contentWidth, lineGap: 3 }
      );

      y += 50;

      // ── Bottom bar ──
      doc.rect(0, 555, pageWidth, 40).fill(BRAND_BLUE);
      doc.fontSize(8).fillColor("#a0c4e8").font("Helvetica");
      doc.text("Tonder · tonder.io · Payments Infrastructure", leftMargin, 567, {
        width: contentWidth,
        align: "center",
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
