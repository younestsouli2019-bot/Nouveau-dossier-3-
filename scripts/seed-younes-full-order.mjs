import { Client } from 'pg';
const c = new Client({ connectionString: 'postgresql://neondb_owner:npg_Vf2nqLByt4Hc@ep-dry-voice-aymtji8x-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require' });
await c.connect();

const PO_ID = `po-${Date.now()}-younes-full`;
const PO_NUMBER = 'PO-PROC-2026-FULL-02';
const RECIPIENT = 'Mr Younes Tsouli';
const ADDRESS = 'Lot. Rita LOT C Im B, APT 17, BOUZNIKA, CASABLANCA SETTAT 13100, Maroc';

const items = [
  // Electronics - IT
  { name: 'Dell Precision 3541 Laptop', brand: 'Dell', category: 'Electronics', qty: 2, price: 899.00 },
  { name: 'Dell Precision 3541 4TB Mounted Storage', brand: 'Dell', category: 'Electronics', qty: 1, price: 299.00 },
  { name: 'OnePlus 15 5G Android Smartphone', brand: 'OnePlus', category: 'Electronics', qty: 1, price: 699.00 },
  { name: 'Mini PC', brand: 'Generic', category: 'Electronics', qty: 1, price: 199.00 },
  { name: 'Monitor for Mini PC', brand: 'Generic', category: 'Electronics', qty: 1, price: 149.00 },
  { name: 'Samsung Smart TV UHD 65"', brand: 'Samsung', category: 'Electronics', qty: 1, price: 450.00 },
  { name: 'Mini Téléphone Portable 2G Double SIM', brand: 'Generic', category: 'Electronics', qty: 1, price: 25.00 },

  // Security cameras
  { name: 'Security Camera Shop Pack', brand: 'Generic', category: 'Security', qty: 1, price: 350.00 },
  { name: 'Accessoires pour Caméras Multiples (kit)', brand: 'Generic', category: 'Security', qty: 1, price: 45.00 },

  // Café / Smoking supplies
  { name: 'Winston Filter Soft', brand: 'Winston', category: 'Tabac', qty: 20, price: 8.50 },
  { name: 'Panter Mignon', brand: 'Panter', category: 'Tabac', qty: 5, price: 7.00 },
  { name: 'Panter Café Crème Original', brand: 'Panter', category: 'Tabac', qty: 5, price: 7.50 },
  { name: 'Camel Yellow Soft Filters', brand: 'Camel', category: 'Tabac', qty: 5, price: 8.00 },
  { name: 'Café Pur Arabica 1kg Bali', brand: 'Bali', category: 'Café', qty: 3, price: 35.00 },
  { name: 'Kit Pause Café Gold', brand: 'Generic', category: 'Café', qty: 1, price: 150.00 },

  // Hospitality
  { name: 'Mini-Bar ELEXIA RM004 (L48xH52xP41)', brand: 'ELEXIA', category: 'Hôtellerie', qty: 1, price: 120.00 },

  // Food
  { name: 'Pack de Légumes Frais Maroc', brand: 'Local', category: 'Alimentaire', qty: 1, price: 30.00 },
  { name: 'Fresh Fish Pack 5kg minimum', brand: 'Local', category: 'Alimentaire', qty: 1, price: 45.00 },

  // Clothing / Shoes
  { name: 'Kricely Trail Shoes EU49/US13', brand: 'Kricely', category: 'Chaussures', qty: 2, price: 45.00 },
  { name: 'Brandit M-65 Giant Jacket Olive 2XL', brand: 'Brandit', category: 'Vêtements', qty: 1, price: 65.00 },
  { name: 'Mil-Tec US Tactical Flight Jacket Black 2XL', brand: 'Mil-Tec', category: 'Vêtements', qty: 1, price: 85.00 },

  // Home / Kitchen
  { name: 'Protecteurs d\'éclaboussures évier cuisine (8 pcs)', brand: 'Generic', category: 'Maison', qty: 8, price: 8.00 },
  { name: '4 Pièces Boîte Rangement Créative Murale', brand: 'Generic', category: 'Maison', qty: 4, price: 22.00 },
  { name: 'Cendrier Créatif Noir', brand: 'Generic', category: 'Maison', qty: 1, price: 12.00 },

  // Stickers / Fun
  { name: '54 Pièces Autocollants Joueurs de Football', brand: 'Generic', category: 'Accessoires', qty: 1, price: 6.00 },
  { name: '50 Autocollants Thème Football', brand: 'Generic', category: 'Accessoires', qty: 1, price: 5.00 },

  // Tools / DIY
  { name: 'Couteau de Poche Compact Pliable', brand: 'Generic', category: 'Outillage', qty: 1, price: 10.00 },
  { name: '2 Artéfacts Ouverture Boîte Impression 3D', brand: 'Generic', category: 'Outillage', qty: 2, price: 12.00 },
  { name: '3x Rouleau Papier Peint Marbré PVC 500x40', brand: 'Generic', category: 'Décoration', qty: 3, price: 18.00 },

  // Health / Beauty
  { name: 'Natural Alternatives to NAC (N-Acétylcystéine)', brand: 'Various', category: 'Santé', qty: 1, price: 25.00 },
  { name: 'Crest 3D Whitestrips Professional Effects', brand: 'Crest', category: 'Santé', qty: 1, price: 45.00 },
  { name: 'Opalescence Go (Dentist whitening)', brand: 'Opalescence', category: 'Santé', qty: 1, price: 65.00 },

  // Wholesale Electronics ($10 or less each)
  { name: 'Wireless Mouse (basic)', brand: 'Generic', category: 'Électronique wholesale', qty: 10, price: 5.00 },
  { name: 'USB Stick 16GB', brand: 'Generic', category: 'Électronique wholesale', qty: 10, price: 4.00 },
  { name: 'Solar Power Bank 5000-10000mAh', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 8.00 },
  { name: 'Bluetooth Earbuds with Case', brand: 'Generic', category: 'Électronique wholesale', qty: 10, price: 7.00 },
  { name: 'Portable Phone Charger 5000mAh', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 6.00 },
  { name: 'USB-C Cable 2m Braided', brand: 'Generic', category: 'Électronique wholesale', qty: 10, price: 3.00 },
  { name: 'Wireless Charging Pad', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 7.00 },
  { name: 'Bluetooth Speaker Mini', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 8.00 },
  { name: 'Smartphone Stand Adjustable', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 4.00 },
  { name: 'Portable LED Desk Lamp USB', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 6.00 },
  { name: 'Car Phone Holder Magnetic', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 5.00 },
  { name: 'Smartwatch Bands Silicone', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 4.00 },
  { name: 'USB Hub 4-Port', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 7.00 },
  { name: 'Laptop Cooling Pad Dual Fan', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 9.00 },
  { name: 'Digital Thermometer Infrared', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 8.00 },
  { name: 'LED Light Strips RGB Remote', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 6.00 },
  { name: 'Rechargeable Batteries AA+Charger', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 9.00 },
  { name: 'Mini USB Desk Fan', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 5.00 },
  { name: 'Bluetooth Tracker Key Finder', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 8.00 },
  { name: 'Wireless Presentation Pointer', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 7.00 },
  { name: 'Phone Camera Lens Clip-on Kit', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 8.00 },
  { name: 'Mini Portable Projector', brand: 'Generic', category: 'Électronique wholesale', qty: 2, price: 10.00 },
  { name: 'USB Rechargeable Lighter', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 5.00 },
  { name: 'LED Keychain Flashlight', brand: 'Generic', category: 'Électronique wholesale', qty: 10, price: 3.00 },
  { name: 'Smartphone Ring Light Clip', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 5.00 },
  { name: 'Portable UV Sterilizer Wand', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 9.00 },
  { name: 'Bluetooth Foldable Keyboard', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 9.00 },
  { name: 'Phone Screen Magnifier 3D', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 6.00 },
  { name: 'Portable Digital Scale Luggage', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 7.00 },
  { name: 'Smartphone Gimbal Stabilizer', brand: 'Generic', category: 'Électronique wholesale', qty: 2, price: 10.00 },
  { name: 'LED Reading Glasses', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 8.00 },
  { name: 'Portable SSD Enclosure USB-C', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 8.00 },
  { name: 'Mini FM Radio Receiver', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 5.00 },
  { name: 'Smartphone Cleaning Kit UV', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 7.00 },
  { name: 'Earphone Organizer Case', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 3.00 },
  { name: 'Lavalier Microphone Clip-on', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 8.00 },
  { name: 'Digital Voice Recorder', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 9.00 },
  { name: 'Electronic Organizer Travel Case', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 6.00 },
  { name: 'Portable FM Transmitter Car', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 7.00 },
  { name: 'Touchscreen Gloves Winter', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 5.00 },
  { name: 'Bluetooth Car Kit AUX Hands-free', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 8.00 },
  { name: 'Digital Kitchen Timer Magnetic', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 4.00 },
  { name: 'Cable Management Clips Adhesive', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 3.00 },
  { name: 'Portable Power Strip USB', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 8.00 },
  { name: 'Smartphone Mini Tripod + Remote', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 7.00 },
  { name: 'Portable Hand Warmer + Power Bank', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 9.00 },
  { name: 'Wireless Earphone Protective Case', brand: 'Generic', category: 'Électronique wholesale', qty: 5, price: 4.00 },
  { name: 'Digital Hygrometer LCD', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 5.00 },
  { name: 'RFID Blocking Wallet', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 6.00 },
  { name: 'Portable Bluetooth Receiver', brand: 'Generic', category: 'Électronique wholesale', qty: 3, price: 7.00 },
];

// Calculate totals
let totalEst = 0;
for (const i of items) { totalEst += i.qty * i.price; }

console.log('Creating PO with', items.length, 'line items, total estimate: $' + totalEst.toFixed(2));

// Create PO
await c.query(`INSERT INTO "PurchaseOrder" (id, "poNumber", title, "supplierName", status, priority, currency, "lineItemCount", "totalAmount", notes, "createdAt", "updatedAt")
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`, [
  PO_ID, PO_NUMBER, 'Full Procurement Order - Mr Younes Tsouli',
  'Multi-Supplier', 'submitted', 'high', 'USD',
  items.length, totalEst,
  'Complete order: IT, café, hospitality, clothing, home, electronics wholesale for Mr Younes Tsouli'
]);

// Create procurement items
let itemIdx = 0;
for (const item of items) {
  const itemId = `pi-${Date.now()}-${itemIdx}`;
  const totalLine = item.qty * item.price;

  await c.query(`INSERT INTO "ProcurementItem" (id, name, brand, category, quantity, "unitPriceEst", "totalEst", currency, "recipientName", "recipientAddress", "deliveryAddress", "prePaidBySwarm", status, "purchaseOrderId", "supplierName", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`, [
    itemId, item.name, item.brand, item.category, item.qty, item.price, totalLine, 'USD',
    RECIPIENT, ADDRESS, ADDRESS,
    true, 'pending', PO_ID, item.brand === 'Generic' ? 'Wholesale supplier' : item.brand,
  ]);

  itemIdx++;
}

// Create shipment for the PO
const shpId = `shp-${Date.now()}-younes-full`;
await c.query(`INSERT INTO "Shipment" (id, "shipmentNumber", "itemName", quantity, carrier, status, "destinationName", "destinationAddress", "destinationCity", "destinationCountry", "originCountry", purpose, currency, notes, "createdAt", "updatedAt")
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`, [
  shpId, PO_NUMBER + '-SHP', 'Full Order: ' + items.length + ' line items for Mr Younes Tsouli',
  1, 'Multi-carrier (DHL/FedEx/Moroccan Post)', 'pending',
  RECIPIENT, ADDRESS, 'BOUZNIKA', 'Morocco', 'France',
  'owner_procurement', 'USD',
  'Full procurement shipment: IT equipment, café supplies, hospitality, clothing, electronics wholesale'
]);

console.log('Created PO:', PO_NUMBER);
console.log('Created', itemIdx, 'procurement items');
console.log('Created shipment:', PO_NUMBER + '-SHP');
console.log('Total estimated value: $' + totalEst.toFixed(2));

await c.end();
