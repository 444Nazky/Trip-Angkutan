# APK karantina (salah label)

Berkas di sini diberi nama versi yang TIDAK sama dengan versionName di dalam APK-nya.
Itu akar kegagalan update: server mengiklankan versi X, perangkat memasang berkas
yang isinya versi lama, versi aplikasi tak pernah berubah, popup update muncul terus.

Verifikasi ulang:

```bash
AAPT=$(ls -d ~/Android/Sdk/build-tools/*/aapt2 | tail -1)
for f in apks/*.apk; do "$AAPT" dump badging "$f" | grep -m1 ^package:; done
```

Berkas ini boleh dihapus — pakai rilis yang sudah diverifikasi saja.
