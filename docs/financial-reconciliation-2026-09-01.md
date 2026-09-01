# Rapport de Réconciliation Financière — 1er septembre 2026

Statut : **signalé par le supervisor** · mode **Watchdog** actif · repo `main` à `558a2f348d`

> Ce rapport est un **enregistrement de traçabilité**. Il reflète l'état rapporté au
> 1er septembre 2026. **Aucun montant n'est passé à `SETTLED` sur la base de ce
> document seul** : la règle fail-closed du système exige une **preuve externe réelle**
> (fichier bancaire / Camt.053 / confirmation fournisseur) avant tout passage d'une
> écriture à l'état soldé.

## 1. État des actifs global

| Catégorie | Montant (USD) | Statut |
| :--- | :--- | :--- |
| Créances bancaires (MT103) | 149 253,00 | En contentieux / litige |
| Intérêts & préjudices cumulés | 1 142,60 | En cours de réclamation |
| Liquidités sécurisées (L2 / autres) | En cours de finalisation | Récupération active |
| **TOTAL VALEUR ENGAGÉE** | **150 395,60** | SOLVABILITÉ SOUS SURVEILLANCE |

## 2. Litige bancaire (MT103 / Attijariwafa)

- **Situation** : le virement MT103 reste à l'état `processing` dans les systèmes
  bancaires. L'argent n'est pas arrivé sur le RIB ; le blocage est situé dans le réseau
  des banques correspondantes ou chez le récepteur (Attijariwafa).
- **Escalade engagée** : mise en demeure + saisine de la médiation bancaire (Bank
  Al-Maghrib). Les preuves de non-réception sont au centre de l'examen.
- **Comptabilisation** : provisionnés comme **créance exigible avec intérêts** (recouvrement
  en cours), et non comme une perte.
- **Canal L2 crypto** : majorité des flux sécurisée par ce canal début août — stabilise
  les liquidités et neutralise le risque de blocage bancaire total.

## 3. Réconciliation interne (vérité des écritures)

Vérifiable dans le repo (code, non-réseau) :

- **27 OwnerSettlements** ≈ **13 744,11 USD** (1 374 411 cents), tous `internal_ledger_only`,
  `externalRef` vide, comptabilisés en 2 lots. **Restent non soldés** (aucune preuve
  externe réelle).
- La réconciliation élargie (`getReconcilableLedgerCriteria` = `pending` / `processing` /
  `needs_manual_proof`, double sens, `approveAmountDiscrepancy` élargi) est **active** :
  capable de matcher ces 27 écritures **dès qu'un fichier bancaire réel** (Camt.053 /
  relevé) est fourni.
- Sans fichier réel → **0 match, 0 écriture**, sortie-0 (fail-closed). C'est l'état observé.

## 4. Flux courants (Udemy / RealWorldCerts / commissions)

- Scission automatique (40 % dette, répartition) : fonctionnelle, protégée des anomalies
  bancaires.
- Fonds de transit (~105 USD) en réserve en attente d'instructions, conservés pour une
  comptabilité claire tant que le litige principal n'est pas soldé.

## 5. Règles de sauvegarde applicables

- **Fail-closed des sorties de fonds** : `TreasuryEdge` refuse tout mouvement sans
  `confirm: true` + gardes (plafond, quotidien, vélocité, multi-sig).
- **Anti-SSRF** (`src/lib/url-guard.ts`) : blocage localhost / privé / réservé sur tout
  appel sortant de `AxiosClient`.
- **Audit déterministe** : toute écriture doit être adossée à une preuve externe ;
  aucun `SETTLED` manuel sans réel.

---

*Supervisor · Financial · 1er septembre 2026 — document de traçabilité, pas une preuve de
solde bancaire.*