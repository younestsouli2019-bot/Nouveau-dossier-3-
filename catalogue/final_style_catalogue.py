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
            @page { size: A4; margin: 0; }
            body { font-family: 'DejaVu Sans', sans-serif; margin: 0; padding: 0; background-color: #fff; color: #333; }
            
            /* Header Style */
            .header { background-color: #fff; padding: 20px 40px; text-align: center; }
            .logo-text { color: #004a99; font-size: 60px; font-weight: bold; margin: 0; letter-spacing: 2px; }
            .logo-subtext { background-color: #f39200; color: white; padding: 5px 20px; font-size: 20px; font-weight: bold; display: inline-block; border-radius: 5px; margin-top: -10px; }
            .header-info { display: flex; justify-content: center; margin-top: 15px; font-size: 18px; color: #004a99; font-weight: bold; }
            .header-info div { margin: 0 20px; }

            /* Banner Style */
            .blue-banner { background-color: #004a99; color: white; text-align: center; padding: 10px 0; font-size: 20px; font-weight: bold; margin: 20px 0; }
            
            /* Category Header */
            .category-header { text-align: center; border-bottom: 2px solid #004a99; margin: 20px 100px; padding-bottom: 5px; }
            .category-header h2 { color: #004a99; margin: 0; font-size: 24px; display: inline-block; background: white; padding: 0 20px; margin-bottom: -15px; }

            /* Grid Layout */
            .container { padding: 0 40px; }
            .product-row { display: block; width: 100%; border-bottom: 1px solid #eee; padding: 15px 0; overflow: hidden; }
            .product-card { width: 48%; float: left; padding: 0 1%; box-sizing: border-box; }
            .product-card.right { float: right; border-left: 1px solid #eee; }
            
            .product-details { width: 60%; float: left; text-align: left; }
            .product-details.ar { text-align: right; direction: rtl; }
            .product-image-container { width: 35%; float: right; text-align: center; }
            
            .product-name { font-weight: bold; font-size: 14px; color: #004a99; margin-bottom: 5px; }
            .product-ref, .product-code, .product-pack { font-size: 12px; color: #666; margin: 2px 0; }
            .product-image { max-width: 100%; max-height: 100px; object-fit: contain; }

            .clear { clear: both; }
            
            /* Footer */
            .footer { position: fixed; bottom: 0; width: 100%; background-color: #004a99; color: white; text-align: center; padding: 10px 0; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1 class="logo-text">ATLAS</h1>
            <div class="logo-subtext">FOURNITURES</div>
            <div class="header-info">
                <div>Fournitures Scolaires & de Bureau</div>
                <div>|</div>
                <div style="direction: rtl;">لوازم مدرسية و مكتبية</div>
            </div>
        </div>

        <div class="blue-banner">
            Catalogue Produits | Product Catalogue | كـاتـالـوج الـمـنـتـجـات
        </div>

        <div class="container">
    """
    
    current_category = None
    for i, p in enumerate(products):
        if p['category'] != current_category:
            if current_category is not None:
                html_template += '</div><div class="container">' # New page/container for new category
            current_category = p['category']
            html_template += f"""
            <div class="category-header">
                <h2>{current_category}</h2>
            </div>
            """
        
        if i % 2 == 0:
            html_template += '<div class="product-row">'

        # Image Logic
        img_file = "full_images/default.jpg"
        brand = p.get('brand', '').upper()
        if 'BIC' in brand: img_file = "full_images/BIC_CRISTAL.jpg"
        elif 'PILOT' in brand: img_file = "full_images/PILOT_G2.jpg"
        elif 'UHU' in brand: img_file = "full_images/UHU_STICK.jpg"
        elif 'SAMSUNG' in brand: img_file = "full_images/SAMSUNG_25W.jpg"
        elif 'KIOXIA' in brand: img_file = "full_images/KIOXIA_USB.jpg"
        elif 'CASIO' in brand: img_file = "full_images/CASIO_FX82.jpg"
        elif 'ACCORD' in brand: img_file = "full_images/ACCORD_STATIONERY.jpg"
        elif 'EXPRESS' in brand: img_file = "full_images/EXPRESS_STATIONERY.jpg"
        elif 'DAMANE' in brand: img_file = "full_images/DAMANE_GOLD_CABLE.jpg"
        elif 'MIVA' in brand: img_file = "full_images/MIVA_HEADPHONES.jpg"
        elif 'PAPIER' in p['category'].upper() or 'RAM' in brand: img_file = "full_images/PAPIER_RAMETTE.jpg"
        
        card_class = "right" if i % 2 != 0 else ""
        
        name_fr = p['name_fr']
        name_ar = p.get('name_ar', '')
        ref = p.get('ref', 'N/A')
        
        html_template += f"""
        <div class="product-card {card_class}">
            <div class="product-details">
                <div class="product-name">{name_fr}</div>
                <div class="product-name ar">{name_ar}</div>
                <div class="product-ref">Réf: {ref}</div>
                <div class="product-code">Code: {ref}</div>
                <div class="product-pack">Boîte de 12 PCS</div>
            </div>
            <div class="product-image-container">
                <img src="{img_file}" class="product-image">
            </div>
        </div>
        """
        
        if i % 2 != 0 or i == len(products) - 1:
            html_template += '<div class="clear"></div></div>'

    html_template += """
        </div>
        <div class="footer">
            www.atlasfournitures.com  |  05 55 44 77 88  |  06 61 33 22 11  |  info@atlasfournitures.com
        </div>
    </body>
    </html>
    """
    return html_template

if __name__ == "__main__":
    with open('/home/ubuntu/catalogue_project/full_product_list.json', 'r') as f:
        products = json.load(f)
    
    html_content = build_html(products)
    with open('/home/ubuntu/catalogue_project/final_catalogue.html', 'w') as f:
        f.write(html_content)
        
    # Generate PDF with WeasyPrint
    HTML(string=html_content, base_url='/home/ubuntu/catalogue_project/').write_pdf('/home/ubuntu/catalogue_project/atlas_professional_catalogue_2026.pdf')
    print("Professional catalogue PDF generated.")
