package com.plantation.tripangkut;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Jembatan JS → installer paket Android.
 *
 * Kenapa plugin ini ada: aplikasi memakai "Custom Self-Hosted Update System"
 * (unduh APK → pasang sendiri, tanpa Play Store). Sisi JS dulu memanggil
 * `window.cordova.plugins.fileOpener2`, padahal plugin Cordova itu tidak pernah
 * terpasang di node_modules maupun terdaftar di capacitor.plugins.json — jadi
 * pemanggilannya SELALU gagal dan tombol update berakhir tanpa pemasangan.
 *
 * Berkas APK diunduh ke Filesystem Directory.Data (getFilesDir()). Path itu
 * harus sudah dibuka di res/xml/file_paths.xml (files-path) agar FileProvider
 * boleh membuat content:// URI-nya.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final String TAG = "ApkInstaller";
    private static final String APK_MIME = "application/vnd.android.package-archive";

    /**
     * Buka berkas APK dengan installer paket bawaan Android (ACTION_VIEW).
     *
     * @param call { path: string } path absolut berkas APK di perangkat,
     *             boleh dengan awalan "file://" maupun tanpa.
     */
    @PluginMethod
    public void install(PluginCall call) {
        String raw = call.getString("path");
        if (raw == null || raw.trim().isEmpty()) {
            call.reject("path berkas APK wajib diisi");
            return;
        }

        String path = raw.trim();
        if (path.startsWith("file://")) {
            path = path.substring("file://".length());
        }

        try {
            File apk = new File(path);
            if (!apk.exists()) {
                call.reject("Berkas APK tidak ditemukan di perangkat: " + path);
                return;
            }
            if (apk.length() <= 0) {
                call.reject("Berkas APK kosong (0 byte) — unduh ulang pembaruan.");
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            // Installer berjalan di proses lain → URI wajib diberi izin baca
            // eksplisit, kalau tidak Android menolak dengan SecurityException.
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(intent);

            Log.d(TAG, "Installer APK dibuka: " + path);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuka installer APK", e);
            call.reject("Gagal membuka installer APK: " + e.getMessage(), e);
        }
    }
}
