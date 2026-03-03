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
  const margin = 8;

  // ── Logo (top-left, larger)
  try {
    const img = await loadImage(msLogo);
    doc.addImage(img, "JPEG", 2, 4, 55, 44);
  } catch {}

  // ── Title (top-right)
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text("MSHS Quotation", pageWidth - margin, 16, { align: "right" });

  // ── Quote info block (right-aligned, beside logo)
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const labelRight = pageWidth - 55;
  const valLeft = labelRight + 3;
  let y = 28;

  const drawInfoRow = (label: string, value: string) => {
    doc.setFont("times", "bold");
    doc.text(`${label}:`, labelRight, y, { align: "right" });
    doc.setFont("times", "normal");
    doc.text(value, valLeft, y);
    y += 5.5;
  };

  drawInfoRow("Quotation #", info.quotationNumber || "—");
  drawInfoRow("Application", info.application || "—");
  // Format dates as "Month Day, Year"
  const formatDateLong = (dateStr: string) => {
    if (!dateStr) return "—";
    // Handle MM/DD/YYYY format
    const parts = dateStr.split("/");
    let d: Date;
    if (parts.length === 3) {
      d = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const createdDate = formatDateLong(info.date);
  const validUntilDate = formatDateLong(info.validUntil);
  const validUntilDisplay = info.validUntil ? `${validUntilDate} (60 Days)` : "—";

  drawInfoRow("Created On", createdDate);
  drawInfoRow("Valid Until", validUntilDisplay);
  drawInfoRow("Quote From", info.quoteFrom || "—");
  drawInfoRow("Issuer", info.issuer || "—");
  drawInfoRow("Attention", info.attention || "—");

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
    `$${item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `$${(item.qty * item.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    item.notes || "",
  ]);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [["Resource", "Type", "Item", "Qty", "Unit $", "Monthly $", "Notes"]],
    body: tableData,
    styles: { font: "times", fontSize: 9, cellPadding: 2, textColor: [0, 0, 0] },
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
  const months = parseInt(info.numberOfMonths) || 12;

  const isOneTimeItem = (item: QuoteLineItem) =>
    item.type === "Compute-On Prem" || item.itemName.startsWith("On-Premise Disk");

  const recurringMonthly = items.filter((i) => !isOneTimeItem(i)).reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const oneTimeMonthly = items.filter((i) => isOneTimeItem(i)).reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const monthlyTotal = recurringMonthly + oneTimeMonthly;
  const total = recurringMonthly * months + oneTimeMonthly;

  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const hasOneTimeItems = items.some((i) => isOneTimeItem(i));

  const hasRecurringItems = items.some((i) => !isOneTimeItem(i));

  const bodyRows: string[][] = [
    ["Project Fund #", info.projectFund || "TBD", ""],
  ];
  if (hasRecurringItems) {
    bodyRows.push(["Monthly", fmt(monthlyTotal), ""]);
  }
  bodyRows.push(["Number of Month", months.toString(), ""]);
  if (hasOneTimeItems) {
    bodyRows.push(["Total", fmt(total), ""]);
  }
  bodyRows.push(["One-Time Upfront (Pre-paid)", fmt(total), ""]);

  const highlightIndex = bodyRows.length - 1;

  autoTable(doc, {
    startY: finalY,
    margin: { left: margin },
    head: [["Item", "Amount", "Notes"]],
    body: bodyRows,
    styles: { font: "times", fontSize: 9.5, cellPadding: 2, textColor: [0, 0, 0] },
    headStyles: {
      fillColor: [68, 114, 196],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 10,
    },
    columnStyles: {
      0: { cellWidth: 50, fontStyle: "bold" },
      1: { cellWidth: 35 },
      2: { cellWidth: 30 },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.row.index === highlightIndex) {
        data.cell.styles.fillColor = [200, 200, 200];
        data.cell.styles.textColor = [0, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    theme: "grid",
    tableWidth: 115,
  });

  // ── Footer
  doc.setFont("times", "italic");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text("This quotation is valid for 60 days from the created date.", margin, pageHeight - 14);
  doc.text("Pricing is based on current Azure/Cloud provider rates and is subject to change.", margin, pageHeight - 9);
  doc.text(
    `Generated ${new Date().toLocaleDateString()}`,
    pageWidth - margin,
    pageHeight - 9,
    { align: "right" }
  );

  doc.save(`Quote_${info.application || "Azure"}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
