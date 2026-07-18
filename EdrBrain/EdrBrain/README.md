# EdrBrain — .NET 8 EDR Sensor

A production-grade Windows Endpoint Detection and Response sensor built on Sysmon, SQLite, and in-process attack graph correlation.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    EdrBrain Service                       │
│                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐ │
│  │  EventLog    │───>│ Correlator  │───>│  Response    │ │
│  │  Watcher     │    │ (Graph +    │    │  Coordinator │ │
│  │ (Sysmon EID) │    │  Sigma +    │    │  (Kill/      │ │
│  │              │    │  Scoring)   │    │  Suspend/    │ │
│  └─────────────┘    └──────┬──────┘    │  Alert)      │ │
│                            │           └──────────────┘ │
│                     ┌──────┴──────┐                      │
│                     │   SQLite    │                      │
│                     │  (edr.db)   │                      │
│                     └─────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

## Quick Start (3 Steps)

### Step 1: Install Sysmon
```powershell
# Run as Administrator — downloads Sysmon + installs with EdrBrain config
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Step 2: Build & Deploy
```cmd
# Run as Administrator — builds, installs service, starts monitoring
deploy.bat
```

### Step 3: Verify
```cmd
sc query EdrBrain
wevtutil qe Microsoft-Windows-Sysmon/Operational /c:5 /f:text
```

### To Uninstall
```cmd
:: Quick uninstall (keeps data)
uninstall.bat

:: Full uninstall (removes everything including data + Sysmon)
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Full
```

## Project Structure

```
EdrBrain/
├── EdrBrain.sln
├── deploy.bat                              # One-click build + install
├── uninstall.bat                           # Quick uninstall
├── .gitignore
├── src/EdrBrain.Service/
│   ├── Program.cs                          # DI + service host
│   ├── Worker.cs                           # 3 hosted services
│   ├── HealthMonitor.cs                    # Self-monitoring
│   ├── appsettings.json                    # All configuration
│   ├── sysmonconfig-export.xml             # Sysmon config (12 EIDs)
│   ├── install.ps1                         # Sysmon download + install
│   ├── uninstall.ps1                       # Full removal script
│   ├── Models/
│   │   ├── NormalizedEvent.cs              # Unified event (12 Sysmon types)
│   │   ├── ProcessNode.cs                  # Graph node with lifecycle
│   │   ├── AttackChain.cs                  # Scored chain + MITRE
│   │   ├── SigmaRule.cs                    # Sigma rule model
│   │   ├── EdrOptions.cs                   # Full config model
│   │   └── Alert.cs                        # Alert with triage
│   ├── Ingestion/
│   │   ├── ISysmonReader.cs
│   │   ├── SysmonCollector.cs              # EventLogWatcher + Channel<T>
│   │   └── EventParser.cs                 # 12 EventID parsers
│   ├── Storage/
│   │   ├── IStateManager.cs
│   │   └── StateManager.cs                # 8 SQLite tables + WAL
│   ├── Engine/
│   │   ├── IGraphEngine.cs
│   │   ├── GraphEngine.cs                  # Incremental + full-scan
│   │   ├── ScoreEngine.cs                  # Multi-signal scoring
│   │   ├── MitreMapper.cs                  # ATT&CK mapping
│   │   └── SigmaRuleEngine.cs              # Hot-reloadable Sigma
│   ├── Response/
│   │   ├── IResponseEngine.cs
│   │   ├── ResponseEngine.cs               # Alert/Suspend/Kill
│   │   └── AlertService.cs                # Persist + forward
│   └── Detection/rules/
│       ├── loaders.json                    # 5 rules (MSHTA, Certutil, etc.)
│       ├── credential_theft.json           # 5 rules (LSASS, SAM, etc.)
│       ├── lateral_movement.json           # 5 rules (WMI, injection, etc.)
│       └── infostealer.json               # 4 rules (wallets, DLLs, etc.)
└── test/EdrBrain.Tests/
    └── EdrBrain.Tests.csproj
```

## Included Pre-Set Config Files

| File | Purpose |
|------|---------|
| `appsettings.json` | EdrBrain sensor configuration (30+ options) |
| `sysmonconfig-export.xml` | Sysmon config covering all 12 EIDs with smart filters |
| `Detection/rules/loaders.json` | LOLBin and loader detection rules |
| `Detection/rules/credential_theft.json` | Credential dumping and infostealer rules |
| `Detection/rules/lateral_movement.json` | Lateral movement and persistence rules |
| `Detection/rules/infostealer.json` | Infostealer and anti-forensics rules |
| `install.ps1` | Sysmon download, install, and verification |
| `uninstall.ps1` | Clean removal (optional Sysmon removal) |

## Sysmon Configuration Details

The included `sysmonconfig-export.xml` covers all 12 EventIDs consumed by EdrBrain:

| EID | Type | Config Strategy |
|-----|------|----------------|
| 1 | ProcessCreate | Include all (primary graph data) |
| 3 | NetworkConnect | Exclude loopback/SSDP; include all real connections |
| 5 | ProcessTerminate | Include all (graph pruning) |
| 7 | ImageLoaded | Exclude Microsoft/Intel/NVIDIA signed DLLs |
| 8 | CreateRemoteThread | Include all (process injection detection) |
| 9 | RawAccessRead | Exclude VSS/wbengine; include all other raw access |
| 10 | ProcessAccess | Exclude AV/EDR/LSASS self-access; include all other |
| 11 | FileCreate | Include user-writable dirs + credential files + scripts |
| 13 | RegistrySetValue | Include Run/RunOnce/Services/LSA/Defender exclusions |
| 17/18 | PipeEvent | Exclude standard Windows pipes; include all other |
| 23 | FileDelete | Include exe deletion + system directory deletion |

## Configuration Reference

All settings in `appsettings.json` (hot-reloadable):

| Setting | Default | Description |
|---------|---------|-------------|
| `SysmonChannel` | `Microsoft-Windows-Sysmon/Operational` | Sysmon event log channel |
| `MonitoredEventIds` | `[1,3,5,7,8,9,10,11,13,17,18,23]` | Sysmon EIDs to collect |
| `ResponsePolicy` | `AlertOnly` | `AlertOnly`, `Suspend`, `KillProcessTree`, `Disabled` |
| `AlertThreshold` | 75 | Score threshold for response |
| `EventRetentionDays` | 30 | SQLite event retention |
| `BatchInsertSize` | 500 | SQLite batch insert size |
| `DatabasePath` | `C:\ProgramData\EdrBrain\edr.db` | SQLite database location |
| `MemoryWarningMb` | 200 | Memory warning threshold |
| `MemoryCriticalMb` | 500 | Memory self-healing threshold |
| `RulesPath` | `Detection/rules` | Sigma rule directory |
| `RuleReloadIntervalSeconds` | 60 | How often to hot-reload rules |
| `HealthCheckIntervalSeconds` | 30 | Self-monitoring interval |

## License

Internal use — Security Engineering Division
