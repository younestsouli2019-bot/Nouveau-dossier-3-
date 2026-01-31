import json

def update_list():
    with open('/home/ubuntu/catalogue_project/full_product_list.json', 'r') as f:
        products = json.load(f)
    
    with open('/home/ubuntu/catalogue_project/extracted_tech.json', 'r') as f:
        new_tech = json.load(f)
    
    # Merge and avoid duplicates based on ref
    existing_refs = {p['ref'] for p in products}
    for item in new_tech:
        if item['ref'] not in existing_refs:
            products.append(item)
            existing_refs.add(item['ref'])
            
    with open('/home/ubuntu/catalogue_project/full_product_list.json', 'w') as f:
        json.dump(products, f, indent=2)
    print(f"Total products now: {len(products)}")

if __name__ == "__main__":
    update_list()
