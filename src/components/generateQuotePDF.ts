import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { QuoteLineItem, QuoteInfo } from "./QuoteBuilder";
import msLogo from "@/assets/mount-sinai-logo.jpg";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function generateQuotePDF(items: QuoteLineItem[], info: QuoteInfo) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  // ── Logo (top-left, larger)
  try {
    const img = await loadImage(msLogo);
    doc.addImage(img, "JPEG", margin, 4, 55, 44);
  } catch {}

  // ── Title (top-right)
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.text("MSHS Quotation", pageWidth - margin, 16, { align: "right" });

  // ── Quote info block (right-aligned, beside logo)
  doc.setFontSize(10);
  const infoX = pageWidth - 100;
  const valX = infoX + 30;
  let y = 28;

  const drawInfoRow = (label: string, value: string) => {
    doc.setFont("times", "bold");
    doc.text(`${label}:`, infoX, y);
    doc.setFont("times", "normal");
    doc.text(value, valX, y);
    y += 5.5;
  };

  drawInfoRow("Quotation #", info.quotationNumber || "—");
  drawInfoRow("Application", info.application || "—");
  drawInfoRow("Quote From", info.quoteFrom || "—");
  drawInfoRow("Issuer", info.issuer || "—");
  drawInfoRow("Attention", info.attention || "—");
  drawInfoRow("Created On", info.date || "—");
  drawInfoRow("Valid Until", info.validUntil || "—");

  // ── Divider
  const dividerY = Math.max(y + 2, 50);
  doc.setDrawColor(68, 114, 196);
  doc.setLineWidth(0.4);
  doc.line(margin, dividerY, pageWidth - margin, dividerY);

  // ── Line items table
  const tableStartY = dividerY + 3;

  const tableData = items.map((item) => [
    item.resource,
    item.type,
    item.itemName,
    item.qty.toString(),
    `$${item.unitPrice.toFixed(2)}`,
    `$${(item.qty * item.unitPrice).toFixed(2)}`,
    item.notes || "",
  ]);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [["Resource", "Type", "Item", "Qty", "Unit $", "Monthly $", "Notes"]],
    body: tableData,
    styles: { font: "times", fontSize: 9, cellPadding: 2 },
    headStyles: {
      fillColor: [68, 114, 196],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9.5,
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 22 },
      2: { cellWidth: 50 },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 20, halign: "right" },
      5: { cellWidth: 22, halign: "right" },
      6: { cellWidth: "auto" },
    },
    theme: "grid",
  });

  // ── Summary table
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const monthlyTotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const months = parseInt(info.numberOfMonths) || 12;
  const oneTimeFunding = monthlyTotal * months;

  autoTable(doc, {
    startY: finalY,
    margin: { left: margin },
    head: [["Item", "Amount", "Notes"]],
    body: [
      ["Project Fund #", info.projectFund || "—", ""],
      ["Monthly Total", `$${monthlyTotal.toFixed(2)}`, ""],
      ["Number of Months", months.toString(), ""],
      ["1 Time Funding", `$${oneTimeFunding.toFixed(2)}`, ""],
    ],
    styles: { font: "times", fontSize: 9.5, cellPadding: 2 },
    headStyles: {
      fillColor: [68, 114, 196],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 10,
    },
    columnStyles: {
      0: { cellWidth: 35, fontStyle: "bold" },
      1: { cellWidth: 35 },
      2: { cellWidth: 45 },
    },
    theme: "grid",
    tableWidth: 115,
  });

  // ── Footer
  doc.setFont("times", "italic");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("This quotation is valid for 60 days from the created date.", margin, pageHeight - 8);
  doc.text(
    `Generated ${new Date().toLocaleDateString()}`,
    pageWidth - margin,
    pageHeight - 8,
    { align: "right" }
  );

  doc.save(`Quote_${info.application || "Azure"}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
