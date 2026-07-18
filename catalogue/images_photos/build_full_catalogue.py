import json
import os
from weasyprint import HTML

def build_html(products):
    html_template = """
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <style>
            @page { size: A4; margin: 10mm; }
            body { font-family: 'DejaVu Sans', sans-serif; margin: 0; padding: 0; background-color: #fff; }
            header { text-align: center; border-bottom: 3px solid #004a99; padding-bottom: 10px; margin-bottom: 20px; }
            header h1 { color: #004a99; font-size: 28px; margin: 0; }
            header h2 { color: #f39200; font-size: 18px; margin: 5px 0; }
            .section-title { background-color: #004a99; color: white; padding: 8px; font-size: 16px; margin-top: 20px; text-transform: uppercase; clear: both; }
            .product-grid { display: block; width: 100%; }
            .product-card { 
                width: 48%; 
                float: left; 
                border: 1px solid #eee; 
                margin: 1%; 
                padding: 10px; 
                box-sizing: border-box; 
                height: 250px;
                overflow: hidden;
            }
            .product-image { width: 100%; height: 100px; object-fit: contain; margin-bottom: 10px; }
            .brand { font-weight: bold; color: #004a99; font-size: 12px; }
            .name-fr { font-size: 11px; margin-bottom: 5px; text-align: left; height: 30px; overflow: hidden; }
            .name-ar { font-size: 13px; margin-bottom: 5px; text-align: right; direction: rtl; height: 30px; overflow: hidden; }
            .ref { font-size: 10px; color: #666; }
            .price-box { border-top: 1px dashed #ccc; margin-top: 5px; padding-top: 5px; text-align: right; font-weight: bold; color: #d00; font-size: 12px; }
            .clear { clear: both; }
            footer { position: fixed; bottom: 0; width: 100%; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #eee; padding: 5px 0; }
        </style>
    </head>
    <body>
        <header>
            <h1>ATLAS FOURNITURES</h1>
            <h2>CATALOGUE GÉNÉRAL 2026 | الدليل العام 2026</h2>
        </header>
    """
    
    current_category = None
    for i, p in enumerate(products):
        if p['category'] != current_category:
            if current_category is not None:
                html_template += '<div class="clear"></div>'
            current_category = p['category']
            html_template += f'<div class="section-title">{current_category}</div>'
        
        # Determine image based on brand or category
        img_file = "full_images/default.jpg"
        brand = p.get('brand', '').upper()
        if 'BIC' in brand: img_file = "full_images/BIC_CRISTAL.jpg"
        elif 'PILOT' in brand: img_file = "full_images/PILOT_G2.jpg"
        elif 'UHU' in brand: img_file = "full_images/UHU_STICK.jpg"
        elif 'SAMSUNG' in brand: img_file = "full_images/SAMSUNG_25W.jpg"
        elif 'KIOXIA' in brand: img_file = "full_images/KIOXIA_USB.jpg"
        elif 'CASIO' in brand: img_file = "full_images/CASIO_FX82.jpg"
        
        name_ar = p.get('name_ar', '')
        
        html_template += f"""
        <div class="product-card">
            <img src="{img_file}" class="product-image">
            <div class="brand">{brand}</div>
            <div class="name-fr">{p['name_fr']}</div>
            <div class="name-ar">{name_ar}</div>
            <div class="ref">REF: {p['ref']}</div>
            <div class="price-box">PRIX: ___________</div>
        </div>
        """
        
        if (i + 1) % 2 == 0:
            html_template += '<div class="clear"></div>'

    html_template += """
        <footer>www.atlasfournitures.com | 05 55 44 77 88 | info@atlasfournitures.com</footer>
    </body>
    </html>
    """
    return html_template

if __name__ == "__main__":
    with open('/home/ubuntu/catalogue_project/full_product_list.json', 'r') as f:
        products = json.load(f)
    
    html_content = build_html(products)
    with open('/home/ubuntu/catalogue_project/full_catalogue.html', 'w') as f:
        f.write(html_content)
        
    HTML(string=html_content, base_url='/home/ubuntu/catalogue_project/').write_pdf('/home/ubuntu/catalogue_project/atlas_full_catalogue_2026.pdf')
    print("Full catalogue PDF generated.")
