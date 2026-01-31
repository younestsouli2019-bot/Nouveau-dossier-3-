import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { parse as csvParse } from "csv-parse/sync";
import { execSync } from "node:child_process";

function safeJson(p, fallback) {
	try {
		const txt = fs.readFileSync(p, "utf8");
		const j = JSON.parse(txt);
		return j && typeof j === "object" ? j : fallback;
	} catch {
		return fallback;
	}
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function readCsv(p) {
	const txt = fs.readFileSync(p, "utf8");
	return csvParse(txt, { columns: true, skip_empty_lines: true });
}

function getPaths() {
	const root = process.cwd();
	const dir = path.resolve(root, "catalogue");
	const productsCsv = path.join(dir, "products.csv");
	const imageMapJson = path.join(dir, "image_map.json");
	const brandThemesJson = path.join(dir, "brand_themes.json");
	const coverImage = path.join(
		dir,
		"ChatGPT Image Jan 29, 2026, 07_09_19 PM.png",
	);
	const outPdf = path.join(dir, "catalogue_master.pdf");
	const outPdfCompressed = path.join(dir, "catalogue_master_compressed.pdf");
	return {
		dir,
		productsCsv,
		imageMapJson,
		brandThemesJson,
		coverImage,
		outPdf,
		outPdfCompressed,
	};
}

function getProductImage(ref, imageMap, baseDir) {
	const raw = imageMap[ref] || null;
	if (raw) {
		const p = path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
		try {
			fs.accessSync(p);
			return p;
		} catch {}
	}
	const placeholder = path.resolve(baseDir, "images", "placeholder.jpg");
	try {
		fs.accessSync(placeholder);
		return placeholder;
	} catch {
		return null;
	}
}

function getBrandTheme(brand, brandThemes, baseDir) {
	const t = brandThemes[brand];
	if (t && typeof t === "object") {
		const logo = t.logo_path
			? path.isAbsolute(t.logo_path)
				? t.logo_path
				: path.resolve(baseDir, t.logo_path)
			: "";
		return {
			divider_color: t.divider_color || "#0e1118",
			logo_path: logo,
			font: t.font || "Helvetica-Bold",
		};
	}
	return { divider_color: "#0e1118", logo_path: "", font: "Helvetica-Bold" };
}

function chunkProductsByBrand(products) {
	const result = {};
	for (const p of products) {
		const b = p.brand || "Divers";
		if (!result[b]) result[b] = [];
		result[b].push(p);
	}
	return result;
}

export function runUltimateCatalogue() {
	const {
		dir,
		productsCsv,
		imageMapJson,
		brandThemesJson,
		coverImage,
		outPdf,
		outPdfCompressed,
	} = getPaths();
	ensureDir(path.dirname(outPdf));
	const products = readCsv(productsCsv);
	const imageMap = safeJson(imageMapJson, {});
	const brandThemes = safeJson(brandThemesJson, {});
	const doc = new PDFDocument({ margin: 50, bufferPages: true });
	const stream = fs.createWriteStream(outPdf);
	doc.pipe(stream);
	let pageCounter = 1;
	const brandPages = {};
	try {
		if (fs.existsSync(coverImage)) {
			doc.image(coverImage, 50, 50, { width: 500 });
		}
	} catch {}
	doc.fontSize(36).text("Catalogue 2026", 50, 400, { align: "center" });
	doc.addPage();
	pageCounter++;
	doc.fontSize(20).text("INDEX", { align: "center" });
	const indexY = doc.y + 20;
	doc.moveDown(2);
	pageCounter++;
	const brandsProducts = chunkProductsByBrand(products);
	for (const [brand, brandProducts] of Object.entries(brandsProducts)) {
		const theme = getBrandTheme(brand, brandThemes, dir);
		brandPages[brand] = pageCounter;
		doc.addPage();
		pageCounter++;
		if (theme.logo_path && fs.existsSync(theme.logo_path)) {
			doc.image(theme.logo_path, 50, 50, { width: 150 });
		}
		doc
			.fillColor(theme.divider_color)
			.font(theme.font)
			.fontSize(32)
			.text(`${brand} Section`, 50, 200, { align: "center" });
		doc.moveDown(4);
		let columns = 2;
		let x = 50;
		let y = doc.y;
		let col = 0;
		for (const product of brandProducts) {
			const imagePath = getProductImage(product.ref, imageMap, dir);
			doc.rect(x, y, 220, 130).stroke();
			if (imagePath) {
				try {
					doc.image(imagePath, x + 10, y + 10, { width: 90, height: 90 });
				} catch {
					doc.rect(x + 10, y + 10, 90, 90).fillAndStroke("#ccd3e0", "#9aa8bf");
					doc.fillColor("#0d1425");
				}
			} else {
				doc.rect(x + 10, y + 10, 90, 90).fillAndStroke("#ccd3e0", "#9aa8bf");
				doc.fillColor("#0d1425");
			}
			doc
				.fontSize(11)
				.fillColor("#0d1425")
				.text(`${product.name_FR} / ${product.name_AR}`, x + 110, y + 10, {
					width: 100,
				});
			doc
				.fontSize(9)
				.fillColor("#3b4a66")
				.text(`Ref: ${product.ref}`, x + 110, y + 30);
			doc
				.fillColor("#3b4a66")
				.text(`Barcode: ${product.barcode}`, x + 110, y + 45);
			doc
				.fillColor("#3b4a66")
				.text(`Packaging: ${product.packaging}`, x + 110, y + 60);
			col++;
			if (col >= columns) {
				col = 0;
				x = 50;
				y += 130 + 20;
				if (y + 130 + 50 > doc.page.height) {
					doc.addPage();
					pageCounter++;
					y = 50;
				}
			} else {
				x += 220 + 20;
			}
		}
	}
	const totalPages = doc.bufferedPageRange().count;
	doc.switchToPage(1);
	doc.moveTo(50, indexY);
	let idx = 1;
	for (const [brand, pageNum] of Object.entries(brandPages)) {
		doc
			.fontSize(14)
			.fillColor("#0d1425")
			.text(`${idx}. ${brand} ....... Page ${pageNum}`);
		idx++;
	}
	for (let i = 0; i < totalPages; i++) {
		doc.switchToPage(i);
		doc
			.fontSize(10)
			.fillColor("gray")
			.text(`Page ${i + 1} / ${totalPages}`, 0, doc.page.height - 30, {
				align: "center",
			});
	}
	doc.end();
	stream.on("finish", () => {
		try {
			execSync(
				`gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outPdfCompressed}" "${outPdf}"`,
			);
			process.stdout.write(
				JSON.stringify({
					ok: true,
					outPdf,
					outPdfCompressed,
					compressed: true,
				}) + "\n",
			);
		} catch {
			process.stdout.write(
				JSON.stringify({ ok: true, outPdf, compressed: false }) + "\n",
			);
		}
	});
}

if (
	import.meta.url ===
	`file://${path.resolve(process.cwd(), "scripts", "ultimateCatalogueSwarm.mjs").replace(/\\/g, "/")}`
) {
	runUltimateCatalogue();
}
