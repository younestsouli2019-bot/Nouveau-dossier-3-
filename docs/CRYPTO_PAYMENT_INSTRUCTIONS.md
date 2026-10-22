# Standing instructions — règlement entrant en USDT (Crypto-First)

**Pour tout partenaire commercial / client devant régler un montant à RealWorldCerts
ou au Swarm : demander le règlement en USDT** sur les adresses ci-dessous, plutôt
qu'un virement bancaire international (SWIFT). Adresses vérifiées sur le compte
Bitget le 2026-10-22.

## Adresses de réception (USDT uniquement)

| Réseau | Adresse | Frais émetteur (indicatif) |
|---|---|---|
| **TRC-20 (Tron) — recommandé** | `TUtM17RZ1jCrXPnLa34o7J59BSEqgqYYBE` | < $1 |
| BEP-20 (BNB Chain) | `0x2700732a6f050c10c080154ce73cc641c448b704` | faible |
| ERC-20 (Ethereum) | `0x2700732a6f050c10c080154ce73cc641c448b704` | quelques $ |

- **Devise acceptée : USDT uniquement.** BTC/ETH/BNB atterrissent sur le compte
  mais ne sont PAS réconciliés automatiquement (rapprochement manuel nécessaire).
- **Convention anti-collision :** pour chaque facture, demander un montant exact
  unique (montant + 2 décimales propres au n° de facture, ex. 1250.13 USDT pour
  la facture 13) ou communiquer le hash de transaction par email. Sans cela,
  deux paiements identiques ne peuvent pas être départagés automatiquement.
- Ne jamais envoyer sur un autre réseau que celui indiqué — perte irrécouvrable.

## Réconciliation automatique (armée, active toutes les 2 h)

1. Le watcher (scripts/rwc-crypto-deposit-watch.mjs, workflow Base44 toutes les
   2 h) détecte tout dépôt USDT confirmé sur le compte Bitget.
2. Correspondance par montant exact → rapprochement au Grand Livre
   (data/out/course-orders.ndjson / infra-budget ledger selon la nature).
3. Notification du propriétaire à chaque dépôt enregistré.
4. Le supervisor financier alloue 30 % des revenus réels au budget
   d'infrastructure (décision UPGRADE_DUE / HOLD).

## Limites assumées (fail-closed)

- Les fonds gelés chez Attijariwafa (149 253,00 USD — 4 virements SWIFT reçus)
  ne sont PAS récupérables par ce canal : ils sont déjà dans le système bancaire
  et leur déblocage passe exclusivement par le dossier de régularisation
  (UETR + agence). Aucun basculement crypto ne les contourne.
- BC646 Banking Circle (63,67 USD) : pas de rail crypto ; retrait uniquement
  via leurs SDK/portail une fois les accès provisionnés.
- Ce document ne modifie pas la politique de conformité : les règles KYC/AML
  applicables aux fonds reçus restent à respecter dans chaque juridiction.
