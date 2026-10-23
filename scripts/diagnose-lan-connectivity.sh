#!/usr/bin/env bash
# =============================================================================
#  diagnose-lan-connectivity.sh
#
#  Alat diagnosis jaringan (TIDAK butuh root) untuk kasus:
#      "Perangkat mobile tidak bisa membuka http://192.168.1.123:8000"
#
#  Logika intuisi:
#    PAKAI MODE LIVE, lalu dari HP buka http://192.168.1.123:8000 di browser.
#
#    - Kalau MAC HP MUNCUL di tabel ARP  -> paket HP sampai ke server.
#      Jaringan OK; masalahnya di layer aplikasi (URL salah, captive portal,
#      atau service worker browser yang cache halaman lama).
#    - Kalau MAC HP TIDAK MUNCUL          -> paket HP tidak pernah sampai.
#      Penyebab: AP/Client Isolation aktif, HP masih di Guest Network,
#      HP tidak connect ke SSID utama, atau data seluler masih menyala.
#
#  Cara pakai:
#      ./scripts/diagnose-lan-connectivity.sh          # snapshot sekali
#      ./scripts/diagnose-lan-connectivity.sh --live   # monitor sampai Ctrl+C
#      ./scripts/diagnose-lan-connectivity.sh --live 120   # 120 detik
# =============================================================================
set -uo pipefail

LAN_DEV="${LAN_DEV:-eno1}"
LAN_IP="${LAN_IP:-192.168.1.123}"
ROUTER="${ROUTER:-192.168.1.1}"
PORTS="${PORTS:-8000 5173 3000}"
INTERVAL=1
LIVE=0
DURATION=0

while [ $# -gt 0 ]; do
  case "$1" in
    --live)   LIVE=1; shift ;;
    --dev)    LAN_DEV="$2"; shift 2 ;;
    --ip)     LAN_IP="$2"; shift 2 ;;
    --router) ROUTER="$2"; shift 2 ;;
    --ports)  PORTS="$2"; shift 2 ;;
    --for)    DURATION="$2"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Argumen tidak dikenal: $1"; exit 2 ;;
  esac
done

hr() { printf '%s\n' "────────────────────────────────────────────────────────────"; }

# ── Snapshot kondisi host ─────────────────────────────────────────────────────
snapshot() {
  echo "== KONDISI SERVER =="
  echo "Host        : $(hostname)"
  echo "Waktu       : $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo
  echo "-- Alamat IPv4 --"
  ip -4 -o addr show | awk '{printf "  %-18s %s\n", $2, $4}'
  echo
  echo "-- Rute (default + LAN) --"
  ip route | sed 's/^/  /'
  echo
  echo "-- Rute ke perangkat pada LAN --"
  ip route get "$ROUTER" 2>/dev/null | sed 's/^/  /'
  echo
  echo "-- Port yang LISTEN (pakai 0.0.0.0 = bisa diakses dari LAN) --"
  ss -tlnH 2>/dev/null | awk '{printf "  %-22s %s\n", $4, $5}' | sort -u
  echo
  echo "-- Binding port Docker --"
  if docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | grep -q .; then
    docker ps --format '  {{.Names}} -> {{.Ports}}' | sed 's/^/  /'
  else
    echo "  (docker tidak bisa diakses tanpa sudo, atau tidak ada container)"
  fi
  echo
  echo "-- Uji HTTP dari server sendiri via IP LAN --"
  for p in $PORTS; do
    code=$(curl -s -o /dev/null -m 4 -w '%{http_code}' "http://$LAN_IP:$p/" 2>/dev/null)
    printf "  http://%s:%s -> %s\n" "$LAN_IP" "$p" "${code:-000}"
  done
  echo
  echo "-- Gateway (router) --"
  ping -c 2 -W 2 "$ROUTER" 2>&1 | sed 's/^/  /'
  echo
  echo "-- Tetangga ARP pada $LAN_DEV (siapa saja yang terlihat di LAN) --"
  ip neigh show dev "$LAN_DEV" 2>/dev/null | grep -vE 'FAILED|INCOMPLETE' | sed 's/^/  /'
  echo
  hr
}

if [ "$LIVE" -eq 0 ]; then
  snapshot
  exit 0
fi

# ── Mode live ────────────────────────────────────────────────────────────────
echo "== MODE LIVE =="
echo "  Monitor :$LAN_DEV   IP server : $LAN_IP   Router : $ROUTER"
echo "  Port    : $PORTS"
echo "  durasi  : ${DURATION:-tak terbatas} detik"
echo
echo "  LANGKAH: dari perangkat mobile, connect ke SSID utama kantor lalu"
echo "           buka  http://$LAN_IP:8000  (atau :5173 / :3000)"
echo "  Tekan Ctrl+C untuk berhenti."
echo
hr

snmp_field() {  # snmp_field <nama-field> -> nilai counter TCP dari /proc/net/snmp
  awk -v k="$1" '
    /^Tcp:/ {
      if (!hdr) { hdr = $0; next }
      nh = split(hdr, H, " "); nv = split($0, V, " ")
      for (i = 2; i <= nh; i++) if (H[i] == k) { print V[i]; exit }
      exit
    }
  ' /proc/net/snmp 2>/dev/null | head -1
}

prev_attempt=$(snmp_field AttemptFails)
prev_active=$(snmp_field ActiveOpens)
prev_estab=$(snmp_field EstabResets)
prev_in=$(snmp_field InSegs)
seen_macs=""
start=$(date +%s)

while :; do
  now=$(date +%s)
  if [ "$DURATION" -gt 0 ] && [ $((now - start)) -ge "$DURATION" ]; then
    echo; echo "== SELESAI (${DURATION} detik) =="; break
  fi

  # 1) MAC baru yang muncul di LAN -> perangkat HP masuk jaringan
  for mac in $(ip neigh show dev "$LAN_DEV" 2>/dev/null \
                | grep -vE 'FAILED|INCOMPLETE|router' | awk '{print $5}'); do
    case " $seen_macs " in *" $mac "*) continue ;; esac
    seen_macs="$seen_macs $mac"
    entry=$(ip neigh show dev "$LAN_DEV" 2>/dev/null | grep "$mac" | head -1)
    echo "[$(date '+%H:%M:%S')] PERANGKAT BARU DI LAN: $entry"
  done

  # 2) Kenaikan counter TCP -> ada SYN yang masuk ke server
  cur_attempt=$(snmp_field AttemptFails)
  cur_active=$(snmp_field ActiveOpens)
  cur_estab=$(snmp_field EstabResets)
  cur_in=$(snmp_field InSegs)

  if [ "${cur_attempt:-0}" -gt "${prev_attempt:-0}" ] 2>/dev/null; then
    echo "[$(date '+%H:%M:%S')] TCP: SYN masuk tapi port tertutup/ditolak (AttemptFails +$((cur_attempt - prev_attempt)))"
  fi
  if [ "${cur_active:-0}" -gt "${prev_active:-0}" ] 2>/dev/null; then
    echo "[$(date '+%H:%M:%S')] TCP: koneksi masuk diterima dari perangkat baru (ActiveOpens +$((cur_active - prev_active)))"
  fi
  if [ "${cur_estab:-0}" -gt "${prev_estab:-0}" ] 2>/dev/null; then
    echo "[$(date '+%H:%M:%S')] TCP: koneksi terputus/reset (EstabResets +$((cur_estab - prev_estab)))"
  fi
  if [ "${cur_in:-0}" -gt "${prev_in:-0}" ] 2>/dev/null; then
    d=$((cur_in - prev_in))
    [ "$d" -gt 50 ] && echo "[$(date '+%H:%M:%S')] TCP: ${d} segmen masuk (ada trafik dari jaringan lain)"
  fi

  prev_attempt=$cur_attempt; prev_active=$cur_active; prev_estab=$cur_estab; prev_in=$cur_in
  sleep "$INTERVAL"
done

echo
snapshot
echo "== CARA MEMBACA HASIL =="
echo "  - 'PERANGKAT BARU DI LAN' muncul  -> HP sampai ke server. Cek layer aplikasi."
echo "  - tidak ada baris sama sekali      -> trafik HP tidak pernah sampai:"
echo "      matikan AP/Client Isolation di router, jangan pakai Guest Network,"
echo "      dan matikan data seluler di HP."
