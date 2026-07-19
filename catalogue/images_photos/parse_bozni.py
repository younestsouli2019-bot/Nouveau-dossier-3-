import re
import json

def parse_bozni_text(text):
    products = []
    # Match patterns like: Reference (often digits) + Description + Quantity + Price + Remise + Total
    # Example: 6970928003664 CRAYON DE COULEUR 12 COURTE KINGGIFFT REF XO-KGCP-S12 BOITE DE 12 1 26,00 26,00
    
    # Simple regex to catch lines that look like product entries
    # Looking for: [Ref/Code] [Description...] [Qty] [Price] [Total]
    # Price and Total usually have commas like 26,00
    pattern = re.compile(r'^(\S+)\s+(.+?)\s+(\d+)\s+([\d,.]+)\s+([\d,.]+)')
    
    lines = text.split('\n')
    for line in lines:
        line = line.strip()
        if not line: continue
        
        # Skip headers and footers
        if any(x in line for x in ["Bon de sortie", "CLIENT FIDEL", "Référence", "Le report", "A reporter", "Arrêté le présent"]):
            continue
            
        match = pattern.match(line)
        if match:
            ref = match.group(1)
            desc = match.group(2)
            qty = match.group(3)
            price = match.group(4)
            total = match.group(5)
            
            # Clean up description (remove extra spaces)
            desc = " ".join(desc.split())
            
            products.append({
                "ref": ref,
                "name_fr": desc,
                "qty": qty,
                "price": price
            })
            
    return products

if __name__ == "__main__":
    # The text was already read in the previous step, I'll use a simplified version for the script
    # or just paste the key parts if needed. But I'll read from the file if I saved it.
    # Since I didn't save the raw text to a file, I'll use the output from the previous tool.
    pass
