**Goal**
- Eliminate exposure via ActivitiesCache.db and related telemetry caches
- Lock down endpoint protections, autostarts, scripting, and network surface

**Disable & Clean Activity History**
- Turn off Activity History: Settings → Privacy & security → Activity history → Uncheck “Store my activity history on this device” and “Send my activity history to Microsoft”; click “Clear history”.
- Group Policy: Computer Configuration → Administrative Templates → System → OS Policies → Set “Allow publishing of User Activities” = Disabled and “Allow upload of User Activities” = Disabled.
- Registry (on approval): Disable HKCU Activity History flags (EnableActivityFeed/PublishUserActivities/UploadUserActivities = 0).
- Clean cache files: %LOCALAPPDATA%\ConnectedDevicesPlatform\L.*\ActivitiesCache.db (+ .wal/.shm) after disabling Activity History.

**Telemetry & Diagnostics**
- Set diagnostics to “Required only” (Minimal). Disable “Connected User Experiences and Telemetry” where permitted.
- Group Policy: Computer Configuration → Administrative Templates → Windows Components → Data Collection → “Allow Telemetry” = Enabled: 0 (Security) or minimum available.
- Disable Inking & Typing personalization; turn off Tailored experiences.

**Endpoint Protection**
- Enable Defender Tamper Protection, Real‑time protection, Cloud‑delivered protection.
- Enable key Attack Surface Reduction rules: block Office child processes, block executable content from email/webmail, block credential theft from LSASS, block script obfuscation.
- Turn on Controlled Folder Access; add protected folders for critical data; enable ransomware recovery.
- Enable Exploit Protection (DEP/ASLR/CFG defaults).

**PowerShell & Office Hardening**
- Constrained Language Mode for non‑admins; log module/script block; enable transcription.
- Block Office macros from the internet; require signed macros; disable VBA in Outlook.
- Disable OLE/DDE Auto‑linking; prevent Office from creating child processes.

**Network & Remote Surface**
- Firewall: default inbound deny; only allow RDP/SSH/VPN if absolutely needed; restrict by IP allowlist.
- Disable SMBv1; require SMB signing; disable LLMNR/NBT‑NS (to reduce spoofing).
- Enforce TLS 1.2/1.3; disable older ciphers via group policy.

**Autostarts & Persistence Audit**
- Review and prune: Startup folder, Run/RunOnce (HKCU/HKLM), Scheduled Tasks, Services, Drivers, WMI subscriptions.
- Use Autoruns (Sysinternals) to baseline and disable non‑essential entries.
- Enable Sysmon for advanced logging; set Audit Policy for process creation (4688), PowerShell, and script block logging.

**Accounts & Disk**
- Remove local admin from daily user; enforce UAC at highest.
- Enable BitLocker with TPM+PIN for OS drive; encrypt data drives; store recovery keys securely.
- Require Windows Hello PIN/biometrics; lock screen after short idle.

**Deliverables (upon approval)**
- Apply Activity History GP/registry hardening and clear caches
- Configure Defender (Tamper Protection, ASR rules, Controlled Folder Access)
- Add firewall and exploit protection baselines
- Provide an audit report (Autoruns baseline, scheduled tasks/services) and a rollback script

I will proceed to apply these controls and produce a concise hardening report if you approve.