#!/system/bin/sh

log() {
  echo "[MOBILE-HARDEN] $1"
}

try_settings() {
  ns="$1"
  key="$2"
  val="$3"
  if settings put "$ns" "$key" "$val" 2>/dev/null; then
    log "Set $ns/$key=$val"
  else
    log "Could not set $ns/$key (permission or unsupported)"
  fi
}

try_svc() {
  svc "$1" "$2" 2>/dev/null && log "svc $1 $2" || log "svc $1 $2 not available"
}

log "Starting Samsung Galaxy A8 hardening (Pegasus/Graphite-style zero-click focus)"

log "Disabling USB debugging and developer options (if permissions allow)"
try_settings global adb_enabled 0
try_settings global development_settings_enabled 0

log "Disabling install from unknown sources where possible"
try_settings secure install_non_market_apps 0
try_settings global install_non_market_apps 0

log "Tightening lockscreen notification privacy"
try_settings secure lock_screen_allow_private_notifications 0
try_settings secure lock_screen_show_notifications 1

log "Encouraging short screen timeout and strong authentication (manual step)"
log "Go to Settings > Lock screen > Secure lock settings and set a short timeout and strong PIN/password."

log "Disabling Wi-Fi auto-join for open networks is mostly manual on Samsung UI"
log "Review Wi-Fi settings and remove or forget any open/untrusted networks."

log "Turning off Bluetooth and Wi-Fi radios (you can re-enable manually when needed)"
try_svc wifi disable
try_svc bluetooth disable

log "Disabling some scanning features where supported"
try_settings global wifi_scan_always_enabled 0
try_settings secure nearby_scanning_enabled 0

log "Play Protect and app permission review require manual confirmation in UI"
log "Open Play Store > Play Protect > enable scanning and Security updates."

log "MMS auto-download and link preview protections are app-specific."
log "For Samsung Messages, WhatsApp, Signal, etc., disable auto-download and link previews via each app's settings."

log "OEM unlock / bootloader relock cannot be fully automated from Android userland."
log "Verify in Developer options that OEM unlocking is disabled and bootloader is locked."

log "Daily reboot recommendation: power-cycle the device at least once per day."

log "Screen overlay / accessibility protections"
log "Review Settings > Apps > Special access > Display over other apps and Accessibility; disable for non-essential apps."

log "Background sync and backup"
log "Review Google backup and vendor backup settings; disable for highly sensitive apps or use a separate hardened device."

log "Hardening complete (best effort). Some steps still require manual review in Settings."

