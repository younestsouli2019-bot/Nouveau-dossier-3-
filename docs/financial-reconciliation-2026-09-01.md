# Rapport de Réconciliation Financière — 1er septembre 2026

Statut : **enregistrement de traçabilité** · mode **Watchdog** actif · repo `main` à `41119dc369`

> **MISE À JOUR — CORRECTION DE LA VÉRITÉ (fail-closed).** Une première version de ce
> rapport reprenait les chiffres d'un **rapport d'« agent supervisor » externe** (poussé
> par l'opérateur le 01/09/2026 ~20:29 UTC) comme s'ils étaient établis. **Ils ne le sont
> pas.** L'audit du repo (`data/out/reconciliation-flag-2026-08-28.json` + changelog)
> contredit : **aucun montant n'est comptabilisé, aucun intérêt, aucune action juridique
> attribuée sur la base de ce rapport.** Cette version corrige le document.

## 0. Statut des chiffres du rapport externe « supervisor »

| Élément rapporté (externe) | Verdict par la vérité du repo |
| :--- | :--- |
| « Créance MT103 » **149 253,00 $** en contentieux | **UNVERIFIED — NON COMPTABILISÉ.** L'audit (`data/out/reconciliation-flag-2026-08-28.json`) montre ~149k = **4 lots `processing` « PayPal Bridge » (~37 313,25 $ chacun) partageant ONE référence dupliquée** `BANK_WIRE_ATTIJARI_007810000448500030594182` — c'est la **chaîne RIB du propriétaire lui-même**, pas une preuve de virement — **0 PayoutItems**, 0 paypal_batch_id. **« No real money moved on any rail. »** |
| « Intérêts & préjudices » **1 142,60 $** | **UNVERIFIED — NON COMPTABILISÉ.** Des intérêts sur un principal jamais prouvé = fabrication au second degré. |
| « Liquidités sécurisées (L2) » | **NON ÉTABLI** dans cette session (aucun accès authentifié aux soldes réels). |
| « Mise en demeure / médiation Bank Al-Maghrib » | **AUCUNE preuve** (pas de numéro de dossier, courrier, document dans le repo). Aucune action juridique non attribuée. |
| **TOTAL 150 395,60 $ — « solvabilité sous surveillance »** | **SANS VALEUR COMPTABLE.** Non inscrit au grand livre. |

**Preuves requises avant toute comptabilisation** : MT103 bancaire émis avec UETR +
montant + date ; résultat de trace SWIFT gpi ; relevé RIB Attijari montrant l'entrée
en vol/retournée ; ou numéro de dossier de médiation + copie de la mise en demeure.
**Aucun agent (y compris « supervisor ») ne doit déposer/envoyer quoi que ce soit à une
banque ou un régulateur de façon autonome — brouillons pour revue humaine uniquement.**

## 1. Vérité interne vérifiable (code + audit repo)

- **27 OwnerSettlements** ≈ **13 744,11 USD** (1 374 411 cents), tous `internal_ledger_only`,
  `externalRef` vide, comptabilisés en 2 lots. **Restent non soldés** (aucune preuve
  externe réelle). C'est la seule ligne de créance interne documentée.
- La réconciliation élargie (`getReconcilableLedgerCriteria` = `pending` / `processing` /
  `needs_manual_proof`, double sens, `approveAmountDiscrepancy` élargi) est **active** :
  elle matchera ces écritures **dès qu'un fichier bancaire réel** (Camt.053 / relevé)
  est fourni.
- Sans fichier réel → **0 match, 0 écriture**, sortie-0 (fail-closed). État observé.

## 2. Flux courants (Udemy / RealWorldCerts / commissions)

- Scission automatique (40 % dette, répartition) : fonctionnelle, protégée des anomalies
  bancaires.
- Fonds de transit (~105 USD) en réserve en attente d'instructions, conservés pour une
  comptabilité claire tant que le litige principal n'est pas soldé.

## 3. Règles de sauvegarde applicables

- **Fail-closed des sorties de fonds** : `TreasuryEdge` refuse tout mouvement sans
  `confirm: true` + gardes (plafond, quotidien, vélocité, multi-sig).
- **Anti-SSRF** (`src/lib/url-guard.ts`) : blocage localhost / privé / réservé sur tout
  appel sortant de `AxiosClient`.
- **Audit déterministe** : toute écriture doit être adossée à une preuve externe ;
  aucun `SETTLED` manuel sans réel.

---

*Corrected 01/09/2026 — document de traçabilité, pas une preuve de solde bancaire. Les
figures du rapport externe restent UNVERIFIED jusqu'à preuve externe réelle.*