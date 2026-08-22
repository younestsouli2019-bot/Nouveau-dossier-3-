import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const dir = path.resolve("catalogue");
  const outPdf = path.join(dir, "atlas_professional_catalogue_2026.pdf");
  ensureDir(dir);
  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(outPdf);
  doc.pipe(stream);
  const coverPath = path.join(dir, "ChatGPT Image Jan 29, 2026, 07_09_19 PM.png");
  if (fs.existsSync(coverPath)) {
    try { doc.image(coverPath, 50, 50, { width: 500 }); } catch {}
  }
  doc.fontSize(36).text("Atlas Professional Catalogue 2026", 50, 400, { align: "center" });
  doc.addPage();
  doc.fontSize(20).text("Anchored Products", { align: "center" });
  doc.moveDown(2);
  const items = [
    {
      title: "Calculator CT-210N (COKTA)",
      image: path.join(dir, "images", "ct-210n.jpg"),
      note: "Auto Power off, 8 digits, handheld",
      ref: "CT-210N",
      source: "Made-in-China",
    },
    {
      title: "Correcteur Stylo EXPRESS XO-0069",
      image: path.join(dir, "images", "express-xo-0069.jpg"),
      note: "Bte 24 pcs",
      ref: "XO-0069",
      source: "Papeteries Chérifiennes",
    },
    {
      title: "Monami Sigmaflo Marqueur Tableau Bleu (Pack 12)",
      image: path.join(dir, "images", "sigmaflo-blue.jpg"),
      note: "Encre liquide, pack de 12",
      ref: "Sigmaflo Bleu x12",
      source: "Marjane Mall",
    },
  ];
  let x = 50;
  let y = doc.y;
  const columns = 2;
  let col = 0;
  for (const it of items) {
    doc.rect(x, y, 220, 160).stroke();
    if (fs.existsSync(it.image)) {
      try { doc.image(it.image, x + 10, y + 10, { width: 100, height: 100 }); } catch {}
    }
    doc.fontSize(12).fillColor("#0d1425").text(it.title, x + 120, y + 10, { width: 90 });
    doc.fontSize(10).fillColor("#3b4a66").text(`Ref: ${it.ref}`, x + 120, y + 40);
    doc.fillColor("#3b4a66").text(it.note, x + 120, y + 55);
    doc.fillColor("#9aa8bf").text(`Source: ${it.source}`, x + 120, y + 70);
    col++;
    if (col >= columns) {
      col = 0;
      x = 50;
      y += 160 + 20;
      if (y + 160 + 50 > doc.page.height) {
        doc.addPage();
        y = 50;
      }
    } else {
      x += 220 + 20;
    }
  }
  doc.end();
  stream.on("finish", () => {
    process.stdout.write(JSON.stringify({ ok: true, outPdf }) + "\n");
  });
}

main();
