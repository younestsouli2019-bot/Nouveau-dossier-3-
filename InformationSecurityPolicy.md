# Information Security Policy

## Governance and Contact
- Security Lead: security@realworldcerts.com
- Scope: Organization-wide systems, data, and operations supporting RealWorldCerts.

## Risk Management
- Documented security program with continuous maturity.
- Periodic risk assessments and control testing.
- Findings tracked to remediation with ownership and due dates.

## Identity and Access Management
- Role-based access control and least privilege enforced.
- Single sign-on for workforce; MFA required for administrative access.
- Access provisioning via ticketed workflow; deprovisioning on role change/exit.
- Centralized audit logging; quarterly access reviews.

## Authentication
- Consumer MFA provided before Plaid Link is surfaced.
- Phishing-resistant MFA enforced for critical systems handling financial data.

## Encryption
- Data in-transit protected with TLS 1.2+.
- Data at-rest encrypted using strong industry-standard ciphers (AES‑256 or equivalent).
- Secrets managed via environment isolation and secure storage; keys rotated on policy.

## Infrastructure and Network Security
- Hardened baselines for servers and services.
- Network filtering and segmentation around sensitive components.
- Configuration changes tracked; security monitoring in place.

## Development and Vulnerability Management
- Secure SDLC with code review and dependency scanning.
- Regular vulnerability scanning of endpoints and production assets.
- Patch management follows severity-based SLAs.

## Logging and Monitoring
- Centralized, immutable logs for authentication, authorization, and financial events.
- Alerting on anomalous activity; periodic review of signals.

## Incident Response
- Defined procedures covering triage, containment, eradication, recovery.
- Post-incident review to strengthen controls.
- Regulatory and customer notifications performed as required.

## Privacy
- Privacy policy displayed within the application where Plaid Link is deployed.
- Explicit consumer consent obtained for collection, processing, and storage of data.

## Data Retention and Disposal
- See Data Retention and Disposal Policy for authoritative periods and deletion methods.
- Disposal events recorded with evidence where applicable.

## Third‑Party Management
- Contractual DPAs and security due diligence for service providers.
- Least privilege scopes and periodic access verification.

## Review and Approval
- Policy reviewed at least annually or upon material changes.
- Approved by executive leadership and security function.
