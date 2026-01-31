import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { parse as csvParse } from "csv-parse/sync";

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
	const outPdf = path.join(dir, "catalogue_master.pdf");
	const coverImage = path.join(
		dir,
		"ChatGPT Image Jan 29, 2026, 07_09_19 PM.png",
	);
	return {
		dir,
		productsCsv,
		imageMapJson,
		brandThemesJson,
		outPdf,
		coverImage,
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

function getBrandTheme(brand, brandThemes) {
	const t = brandThemes[brand];
	if (t && typeof t === "object") return t;
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

export function runAdvancedCatalogue() {
	const {
		dir,
		productsCsv,
		imageMapJson,
		brandThemesJson,
		outPdf,
		coverImage,
	} = getPaths();
	ensureDir(path.dirname(outPdf));
	const products = readCsv(productsCsv);
	const imageMap = safeJson(imageMapJson, {});
	const brandThemes = safeJson(brandThemesJson, {});
	const doc = new PDFDocument({ margin: 50 });
	const stream = fs.createWriteStream(outPdf);
	doc.pipe(stream);
	try {
		if (fs.existsSync(coverImage)) {
			doc.image(coverImage, 50, 50, { width: 500 });
		}
	} catch {}
	doc.fontSize(36).text("Catalogue 2026", 50, 400, { align: "center" });
	doc.addPage();
	doc.fontSize(20).text("INDEX", { align: "center" });
	doc.moveDown(2);
	const brandList = Array.from(new Set(products.map((p) => p.brand)));
	for (let i = 0; i < brandList.length; i++) {
		doc.fontSize(14).text(`${i + 1}. ${brandList[i]}`);
	}
	doc.addPage();
	const brandsProducts = chunkProductsByBrand(products);
	for (const [brand, brandProducts] of Object.entries(brandsProducts)) {
		const theme = getBrandTheme(brand, brandThemes);
		doc.addPage();
		if (theme.logo_path) {
			const lp = path.isAbsolute(theme.logo_path)
				? theme.logo_path
				: path.resolve(dir, theme.logo_path);
			if (fs.existsSync(lp)) {
				doc.image(lp, 50, 50, { width: 150 });
			}
		}
		doc
			.fillColor(theme.divider_color)
			.font(theme.font)
			.fontSize(32)
			.text(`${brand} Section`, 50, 200, { align: "center" });
		doc.moveDown(4);
		let x = 50;
		let y = doc.y;
		const columns = 2;
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
					width: 220 - 120,
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
					y = 50;
				}
			} else {
				x += 220 + 20;
			}
		}
	}
	doc.end();
	stream.on("finish", () => {
		process.stdout.write(JSON.stringify({ ok: true, outPdf }) + "\n");
	});
}

if (
	import.meta.url ===
	`file://${path.resolve(process.cwd(), "scripts", "advancedCatalogueSwarm.mjs").replace(/\\/g, "/")}`
) {
	runAdvancedCatalogue();
}
