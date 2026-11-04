# Banking Circle — KYC / beneficiary appointment covering pack

> Working document. Fill every `[BRACKETED]` field before sending. Do not add
> figures that are not reproduced by the audit in `ci/audit-stuck-payouts.yml`
> (evidence artifact retained 90 days).

## Subject line

`Beneficiary appointment request — [LEGAL ENTITY NAME] — account [ACCOUNT REFERENCE]`

## Body

Dear [BANKING CIRCLE CONTACT / ONBOARDING TEAM],

We are writing regarding the settlement account held by [LEGAL ENTITY NAME]
with Banking Circle ([ACCOUNT / IBAN REFERENCE]).

We understand the appointment of the beneficiary to be an action completed on
your side under the account agreement, and we are therefore asking for the
procedure rather than attempting a technical change on our side. Please let us
know which form, portal step, or signed instruction you require, and to which
address it should be returned.

We have attached the KYC pack listed below. All records referenced in this
letter were generated on **31 August 2026** and are reproducible on request
from the audit job and its retained evidence artifact. Where a statement
(CAMT.053 or equivalent) and our internal audit disagree, the audit figure is
the operative one and this letter will be corrected accordingly.

Please confirm receipt and, if anything is missing, the specific document and
format you need.

Kind regards,
[NAME], [TITLE]
[LEGAL ENTITY NAME]
[REGISTERED ADDRESS]
[EMAIL] · [PHONE]

## KYC pack — nine documents banks actually ask for

1. Certificate of incorporation (and any certificate of change of name).
2. Articles of association / constitutional documents, current version.
3. Register of directors and register of shareholders (or equivalent).
4. Proof of registered address (utility bill or bank statement, < 3 months).
5. Ultimate beneficial ownership (UBO) declaration, signed and dated.
6. Certified ID documents for each director and UBO (passport / national ID).
7. Proof of residential address for each director and UBO (< 3 months).
8. Business licence or evidence of the licensed activity, plus the KYC
   questionnaire completed in full.
9. Source-of-funds and source-of-wealth statement, supported by the bank
   statements or settlement statements referenced in this letter.

## Enclosures / provenance

- [LIST ENCLOSED FILES, one per line — do not enclose anything not listed]
- Records generated: 31 August 2026
- Reproducible via: `npm run audit:stuck` in the `production` environment
  (read-only; evidence artifact `audit-evidence-<run-id>`, retained 90 days)
- Authoritative statement: CAMT.053 / [BANK STATEMENT REFERENCE]

## Internal notes — do not send

- No monetary figure appears in this letter. The previously drafted $8,520
  correction is withdrawn entirely: a letter that raises an unverifiable
  figure and then retracts it is weaker than one that never mentions it.
- If the bank asks for the number, answer only with the audited total from
  the evidence artifact, and attach it.
- Open question: verified recipient address for Banking Circle onboarding.
  Do not send to a guessed address.
