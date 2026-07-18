from weasyprint import HTML
import os

def generate_pdf():
    html_path = '/home/ubuntu/catalogue_project/catalogue.html'
    output_pdf = '/home/ubuntu/catalogue_project/atlas_catalogue_2026.pdf'
    
    # WeasyPrint handles external images if paths are relative or absolute
    # Since images are in /home/ubuntu/catalogue_project/images/
    # and html is in /home/ubuntu/catalogue_project/
    # relative path "images/ST-001.jpg" should work if base_url is set.
    
    HTML(filename=html_path, base_url='/home/ubuntu/catalogue_project/').write_pdf(output_pdf)
    print(f"PDF generated successfully at {output_pdf}")

if __name__ == "__main__":
    generate_pdf()
