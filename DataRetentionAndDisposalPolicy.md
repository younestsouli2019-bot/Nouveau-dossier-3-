# Data Retention and Disposal Policy

## Purpose and Scope
- Defines retention periods and secure disposal for data processed by RealWorldCerts.
- Applies to consumer financial data, operational logs, backups, and related records.

## Data Classification
- Consumer financial data and identifiers.
- Operational telemetry and security logs.
- Backups and derived artifacts.

## Retention Schedule
- Consumer financial data: retained only as necessary to fulfill obligations; default 2 years unless law or contract requires different.
- Security and operational logs: 12 months, extended for investigations as needed.
- Backups: 90 days rolling.
- Exceptions documented and approved by Security Lead.

## Secure Disposal Methods
- Cryptographic erasure or provider‑backed secure deletion for managed services.
- Verified overwrite or destruction for local media.
- Deletion events logged with time, dataset, and operator; audits retained.

## Legal Holds
- When legal or regulatory holds apply, automated deletion is suspended for affected datasets until release.

## Access Controls
- Retention stores restricted to authorized personnel; least privilege enforced.
- Administrative actions require MFA and are auditable.

## Reviews and Updates
- Semiannual review of retention periods and disposal procedures.
- Adjustments made to align with applicable laws and platform requirements.

## Roles and Responsibilities
- Security Lead owns policy and approvals.
- Engineering and Operations execute retention and disposal workflows.
