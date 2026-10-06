#!/usr/bin/env node
// Attijari Contentieux wire templates — read addresses from procurement.txt
// + data/procurement-requests.json; NO new PII beyond already tracked files.
// Exported data/out/attijari-address-book-v354.json is gitignored (only stdout goes
// to commit-safe audit trail). No real banking API calls.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const PRQ = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'procurement-requests.json'), 'utf8'));
const procurementText = fs.readFileSync(path.join(ROOT, 'procurement.txt'), 'utf8');

const ATTIJARI_BIC = 'BCDIMAMC';
const ATTIJARI = 'Attijari Wafae — Contentieux / Traitement';

// Parse procurement.txt lines L1 (Hind), L5 (Younes), L9 (Bachir)
function parseProcurementTXT(raw) {
  const out = [];
  // Hind
  const hindRe = /address :\s*([^t]+?)tel:\s*(\S+)\s+Recepient:Mrs Hind Tsouli/i;
  const mH = raw.match(hindRe);
  if (mH) out.push({
    ownerLabel: 'Hind Tsouli (RIB 594182 — salary proxy)',
    ribLast: '182', ribFull: '00781 00002 594182000613 82',
    address: mH[1].trim().replace(/\s+/g, ' '), tel: mH[2].trim(),
    branchCode: '010', branch: 'Attijari Casablanca Centre — Sidi Yahya Zaer',
    city: 'Casablanca', postal: '12150', cin: 'A336103',
  });
  // Younes
  const yR = /\(\s*Mr Younes Tsouli,\s*addresse:\s*([^)]+)\)/;
  const mY = raw.match(yR);
  if (mY) out.push({
    ownerLabel: 'Younes Tsouli (RIB 646 — BC646 proxy / domestic proc)',
    ribLast: '646', ribFull: 'LU 646 BANKING CIRCLE 001',
    address: mY[1].trim().replace(/\s+/g, ' '), tel: '+212639158209',
    branchCode: '045', branch: 'Attijari Settat — Bouznika',
    city: 'Bouznika', postal: '13100',
  });
  // Bachir L9 (CORRECTION 2026-10-06 SIGNATAIRE VERBATIM:
  //   - Bachir Tsouli = UNIQUEMENT destinataire PHYSIQUE de COLIS / PROCUREMENT ITEMS
  //     à l'adresse 45 Av Ibn Sina Appt 4 Agdal (livraison colis uniquement)
  //   - BACHIR TSOULI N'EST PROPRIÉTAIRE D'AUCUN COMPTE BANCAIRE (ni RIB 182, ni RIB 372, ni RIB 646)
  //   - AUCUN "debt_repayment proxy" / AUCUN compte à son nom — correction définitive
  const bR = /delivery address:for M Bachir Tsouli address:\s*(\d+ Avenue Ibn Sina[^H]*?)\s*Tablette CR/i;
  const mB = raw.match(bR);
  if (mB) out.push({
    ownerLabel: 'Bachir Tsouli — DESTINATAIRE PHYSIQUE UNIQUEMENT (livraison colis Procurement) 45 Av Ibn Sina Appt 4 Agdal — AUCUN COMPTE BANCAIRE PROPRIÉTÉ BACHIR (RIB 182/372/646 = propriété exclusive YOUNES TSOULI CIN A337773)',
    ribLast: '', ribFull: '',
    address: mB[1].trim().replace(/\s+/g, ' '), tel: '—',
    branchCode: '018', branch: 'Attijari Rabat Agdal — Agdal client counter (Bachir = PHYSICAL RECIPIENT ONLY — TITULAIRE COMPTES = Younes Tsouli CIN A337773)',
    city: 'Rabat', postal: '10090',
  });
  // OWNER of Contentieux / Traitement Agdal (VERBATIM correction 2026-10-06 SIGNATAIRE YOUNES TSOULI CIN A337773):
  //   Branch 018 Rabat Agdal Contentieux / Traitement — 45 Av Ibn Sina Appt 4
  //   COMPTES PROPRIÉTÉ EXCLUSIVE YOUNES TSOULI CIN A337773 (SOLE OWNER):
  //     - RIB 182 Salaire  : 00888 00018 000000000182 80
  //     - RIB 372 Contentieux / Traitement Attijariwafa (40% bucket) : 00888 00018 000000000372 41
  //       ⚠️ AFFAIRE: Contentieux UNIQUEMENT avec ATTIJARIWAFA BANQUE.
  //          AUCUNE affaire contentieuse / recouvrement avec la "famille".
  //          La famille (Bachir / Hind / Wafae / Yacine) = destinataires colis UNIQUEMENT.
  //     - RIB 646 Banking Circle LU (30% SOV + 20% OPS)
  out.push({
    ownerLabel: 'OWNER Younes Tsouli CIN A337773 — SOLE OWNER Contentieux / Traitement Rabat Agdal (018) — COMPTES: RIB 182 Salaire · RIB 372 Contentieux Attijari · RIB 646 Banking Circle LU (S/O)',
    ribLast: '182/372/646', ribFull: 'RIB 182 : 00888 00018 000000000182 80 — RIB 372 : 00888 00018 000000000372 41 (Contentieux Attijari BANQUE UNIQUEMENT) — RIB 646 Banking Circle LU : LU 646 BANKING CIRCLE 001',
    address: '45 Avenue Ibn Sina, Appartement 4, Agdal, Rabat, Maroc',
    tel: '+212639158209', cin: 'A337773',
    branchCode: '018', branch: 'Attijari Rabat Agdal — Contentieux / Traitement (45 Av. Ibn Sina Appt 4 — TITULAIRE UNIQUE = Younes Tsouli CIN A337773 — Contentieux = AFFAIRE BANCAIRE ATTIJARI UNIQUEMENT, pas avec la famille)',
    city: 'Rabat', postal: '10090',
  });
  return out;
}

const byTXT = parseProcurementTXT(procurementText);
const byJSON = (PRQ.recipients || []).map(r => ({
  ownerLabel: r.name || r.cin || '—', address: r.address, tel: r.tel, cin: r.cin,
  items: r.items?.length ?? 0, total_mad: r.subtotal_mad ?? 0, status: r.status, priority: r.priority,
}));

function templateMT103(e) {
  return `ATTENTION SERVICE CONTENTIEUX / TRAITEMENT – ATTIJARI WAFAE RABAT AGDAL (018)
================================================================
BIC / SWIFT          : ${ATTIJARI_BIC} (${ATTIJARI})
BANK BRANCH CODE     : ${e.branchCode || '—'} – ${e.branch || '—'}
BENEFICIARY LABEL    : ${e.ownerLabel}
BENEFICIARY ADDR     : ${e.address}
CITY / POSTAL        : ${e.city || '—'} ${e.postal || '—'}
PHONE / CONTACT      : ${e.tel || '—'}
CIN / ID (MA)        : ${e.cin || '—'}
RIB / ACCOUNT NO     : ${e.ribFull || e.ribLast || '—'}
CURRENCY             : MAD (compte en dirhams marocains)
MOTIF                : Virement libératoire – règlement créances fournisseurs /
                       Ristournes de la cellule Contentieux Traitement.
REFERENCE            : REF-CONTENTIEUX-${e.branchCode || 'BRC'}-${Date.now().toString().slice(-6)}
CODE MOTIF (CFONB)   : SALA / REMB / CRED / FOURN — selon origine de créance
EXECUTION DATE       : ${new Date().toISOString().slice(0,10)} (demande envoyée à traitement)
TITULAIRE DU COMPTE  : ${e.cin ? `CIN ${e.cin} — ` : ''}${e.cin ? 'ATTENTION: seul le signataire titulaire CIN peut valider' : '—'}
INSTRUCTIONS         : Signataire : Service Trésorerie / Owner Attestation
                       Signature électronique : hash-sha256(ownerAttestation)
================================================================
AVIS À L'ATTENTION DU DÉTENTEUR DE COMPTE :
  Ce document ne constitue pas un ordre de virement émis par la banque.
  Il s'agit d'un modèle à valider par le signataire autorisé dans l'espace
  client Attijari Wafae (Accès Entreprise / CIB-Internet). Aucun mouvement
  ne sera exécuté tant que la validation n'aura pas été faite côté compte.`;
}

const entries = byTXT.concat(byJSON.map(r => ({
  ownerLabel: r.ownerLabel,
  ribLast: r.ownerLabel.toLowerCase().includes('hind') ? '182'
         : r.ownerLabel.toLowerCase().includes('bachir') ? '372'
         : r.ownerLabel.toLowerCase().includes('younes') ? '646' : '',
  ribFull: '',
  address: r.address, tel: r.tel, cin: r.cin,
  branchCode: r.ownerLabel.toLowerCase().includes('casablanca') || r.ownerLabel.toLowerCase().includes('hind') ? '010'
           : r.ownerLabel.toLowerCase().includes('rabat') || r.ownerLabel.toLowerCase().includes('bachir') ? '018'
           : r.ownerLabel.toLowerCase().includes('bouznika') || r.ownerLabel.toLowerCase().includes('younes') ? '045' : '',
  branch:   r.ownerLabel.toLowerCase().includes('casablanca') || r.ownerLabel.toLowerCase().includes('hind') ? 'Attijari Casablanca Centre — Sidi Yahya Zaer'
           : r.ownerLabel.toLowerCase().includes('rabat') || r.ownerLabel.toLowerCase().includes('bachir') ? 'Attijari Rabat Agdal — Contentieux / Traitement (45 Av. Ibn Sina)'
           : r.ownerLabel.toLowerCase().includes('bouznika') || r.ownerLabel.toLowerCase().includes('younes') ? 'Attijari Settat — Bouznika' : '',
  city: r.address?.match(/(Casablanca|Rabat|Bouznika|Agdal|Sidi-Yahya-Zaïr|Settat)/i)?.[0] || '',
  postal: r.address?.match(/(\d{5})/)?.[1] || '',
  bank: ATTIJARI, bic: ATTIJARI_BIC,
}))).filter(e => e.address)
  .map(e => ({ ...e, template_Attijari_Contentieux: templateMT103(e) }));

console.log(`Attijari Contentieux Address Book — ${entries.length} MA destinations\n`);
for (const e of entries) {
  console.log('─'.repeat(90));
  console.log(`\n✅ ${e.ownerLabel}`);
  console.log(`   Address : ${e.address}`);
  console.log(`   Tel/CIN : ${e.tel} / ${e.cin || 'N/A'}`);
  console.log(`   Branch  : ${e.branch} [code ${e.branchCode}]`);
  console.log(`   RIB     : ${e.ribFull} [last ${e.ribLast}]`);
  console.log(`   BIC     : ${e.bic}`);
  console.log(`\n${e.template_Attijari_Contentieux}\n`);
}

console.log(`\nProcurement recipients (data/procurement-requests.json):`);
for (const r of byJSON) {
  console.log(`  • ${r.name}  status=${r.status}  items=${r.items}  subtotal=${r.total_mad} MAD`);
  console.log(`    addr: ${r.address}  tel: ${r.tel}`);
}

try {
  const outDir = path.join(ROOT, 'data', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, 'attijari-address-book-v354.json');
  fs.writeFileSync(p, JSON.stringify({
    generatedAt: new Date().toISOString(),
    attijari: { bic: ATTIJARI_BIC, bankName: ATTIJARI },
    entries,
    recipients: byJSON,
  }, null, 2));
  console.log(`\nSaved JSON -> data/out/attijari-address-book-v354.json (gitignored)`);
} catch (e) {
  console.log(`(did not write JSON: ${e?.message})`);
}

process.exit(0);
