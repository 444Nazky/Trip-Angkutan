#!/usr/bin/env bash
# =============================================================================
#  setup-static-ip-eno1.sh
#
#  Mengubah IP LAN PC kantor dari DHCP (dapat bergeser kapan saja) menjadi
#  STATIS 192.168.1.123/24, gateway 192.168.1.1, DNS router.
#
#  Kenapa perlu:
#    - Alamat admin dashboard & backend intranet yang dibagikan ke HP adalah
#      http://192.168.1.123. Kalau DHCP memberi alamat lain, semua bookmark
#      dan konfigurasi di HP mati.
#    - address eno1 sekarang berstatus "dynamic" (lihat `nmcli -f IP4 device
#      show eno1`), artinya sewaktu-waktu bisa bergeser setelah lease habis.
#
#  Syarat:
#    - Jalankan dengan sudo.
#    - Pastikan kabel LAN eno1 tersambung ke router Linksys (gateway 192.168.1.1).
#    - Jangan jalankan lewat SSH kalau tidak ada akses fisik/konsol, karena
#      alamat IP bisa berubah di tengah proses (script menyimpan back-up).
#
#  Pemakaian:
#      sudo ./scripts/setup-static-ip-eno1.sh            # terapkan
#      sudo ./scripts/setup-static-ip-eno1.sh --rollback # kembalikan DHCP
# =============================================================================
set -euo pipefail

DEV="${DEV:-eno1}"
IP="${IP:-192.168.1.123}"
CIDR="${CIDR:-24}"
GW="${GW:-192.168.1.1}"
DNS="${DNS:-192.168.1.1 8.8.8.8}"
CONN="${CONN:-netplan-${DEV}}"

ROLLBACK=0
[ "${1:-}" = "--rollback" ] && ROLLBACK=1

[ "$(id -u)" -eq 0 ] || { echo "Harus dijalankan dengan sudo."; exit 1; }

BACKUP_DIR="/var/backups/trip-REQ"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# ── Backup konfigurasi lama ──────────────────────────────────────────────────
backup() {
  nmcli connection show "$CONN" > "$BACKUP_DIR/$CONN.$STAMP.txt" 2>/dev/null || \
    nmcli -t -f NAME,DEVICE,TYPE connection show --active > "$BACKUP_DIR/active-conns.$STAMP.txt" 2>/dev/null || true
  ip -4 addr show dev "$DEV" > "$BACKUP_DIR/ip-$DEV.$STAMP.txt" 2>/dev/null || true
  ip route > "$BACKUP_DIR/route.$STAMP.txt" 2>/dev/null || true
  echo "Backup konfigurasi lama: $BACKUP_DIR/*.$STAMP.txt"
}

echo "== Target =="
echo "  interface : $DEV"
echo "  alamat    : $IP/$CIDR"
echo "  gateway   : $GW"
echo "  DNS       : $DNS"
echo "  profile   : $CONN"
echo

# Pastikan iface eno1 ada
if ! ip link show "$DEV" >/dev/null 2>&1; then
  echo "[X] Interface $DEV tidak ada di mesin ini." >&2
  exit 1
fi

# Pastikan gateway hidup (kalau tidak, iface mungkin bukan yang ke router)
if ! ping -c 1 -W 2 "$GW" >/dev/null 2>&1; then
  echo "[!] Gateway $GW tidak merespons ping dari $DEV."
  echo "    Lanjut? (y/N)"; read -r ans
  [ "$ans" = "y" ] || { echo "Batal."; exit 1; }
fi

backup

if [ "$ROLLBACK" -eq 1 ]; then
  echo "== Kembalikan ke DHCP =="
  nmcli connection modify "$CONN" \
    ipv4.method auto \
    ipv6.method auto \
    ipv4.addresses "" ipv4.gateway "" ipv4.dns "" ipv4.dns-search "" 2>/dev/null || true
  nmcli connection up "$CONN"
  echo "Selesai. IP sekarang:"
  ip -4 addr show dev "$DEV" | sed 's/^/  /'
  exit 0
fi

echo "== Terapkan IP statis =="
nmcli connection modify "$CONN" \
  ipv4.method manual \
  ipv4.addresses "$IP/$CIDR" \
  ipv4.gateway "$GW" \
  ipv4.dns "$DNS" \
  ipv4.never-default no \
  ipv6.method ignore

# Simpan juga ke netplan supaya tetap berlaku setelah reinstall/upgrade.
if command -v netplan >/dev/null 2>&1; then
  NETPLAN_FILE="/etc/netplan/99-trip-REQ-$DEV.yaml"
  cat > "$NETPLAN_FILE" <<EOF
# Dibuat otomatis oleh scripts/setup-static-ip-eno1.sh
# IP statis PC kantor Trip Angkutan (server intranets 192.168.1.123).
# Hapus file ini + kembalikan profile NM ke auto (dhcp) bila ingin balik DHCP.
network:
  version: 2
  ethernets:
    $DEV:
      dhcp4: false
      dhcp6: false
      addresses:
        - $IP/$CIDR
      routes:
        - to: default
          via: $GW
      nameservers:
        addresses:
$(for d in $DNS; do echo "          - $d"; done)
EOF
  chmod 600 "$NETPLAN_FILE"
  netplan generate >/dev/null 2>&1 || true
  echo "  -> $NETPLAN_FILE dibuat."
fi

echo "  -> Applying (koneksi eno1 sebentar boleh putus)..."
nmcli connection up "$CONN"

sleep 2
echo
echo "== Hasil =="
ip -4 addr show dev "$DEV" | sed 's/^/  /'
ip route | sed 's/^/  /'
echo
echo "== Verifikasi =="
for p in 8000 5173 3000; do
  code=$(curl -s -o /dev/null -m 4 -w '%{http_code}' "http://$IP:$p/" 2>/dev/null)
  printf "  http://%s:%s -> %s\n" "$IP" "$p" "${code:-000}"
done
echo
echo "Selesai. IP $IP kini statis dan tidak akan bergeser karena DHCP."
