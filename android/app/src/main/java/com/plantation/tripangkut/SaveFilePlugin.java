package com.plantation.tripangkut;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Simpan file lewat file manager Android.
 *
 * ACTION_CREATE_DOCUMENT membuka pemilih lokasi bawaan Android. Pengguna bebas
 * memilih folder (Download, WhatsApp, dokumen, dsb.) dan aplikasi hanya
 * menulis ke URI yang dipilih, tanpa meminta izin penyimpanan luas.
 *
 * Penulisan dilakukan BERTAHAP (begin → append → finish), bukan sekali kirim.
 * Ekspor data trip berisi foto base64 sehingga JSON bisa puluhan MB; mengirim
 * seluruh teks lewat jembatan JS dan menulisnya sekaligus membuat memori habis
 * (aplikasi tertutup) dan menyisakan berkas 0 byte.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private OutputStream pendingOutput;
    private Uri pendingUri;
    private String pendingName;
    private long pendingBytes;

    @PluginMethod
    public void begin(PluginCall call) {
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "application/json");
        if (filename == null || filename.trim().isEmpty()) {
            call.reject("Nama file wajib diisi");
            return;
        }
        if (pendingOutput != null) {
            closeQuietly();
        }
        pendingName = filename.trim();
        pendingUri = null;
        pendingBytes = 0;

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, pendingName);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK) {
            clearPending();
            call.reject("Ekspor dibatalkan", "CANCELLED");
            return;
        }

        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (uri == null) {
            clearPending();
            call.reject("Lokasi penyimpanan tidak dipilih");
            return;
        }

        pendingUri = uri;
        io.execute(() -> {
            try {
                OutputStream output = getContext().getContentResolver().openOutputStream(uri);
                if (output == null) throw new IllegalStateException("Tidak bisa membuka lokasi simpan");
                pendingOutput = output;

                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                ret.put("name", resolveDisplayName(uri));
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                closeQuietly();
                getActivity().runOnUiThread(() -> call.reject(
                    "Gagal membuka file: " + e.getMessage(), e));
            }
        });
    }

    @PluginMethod
    public void append(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Isi file wajib diisi");
            return;
        }
        if (pendingOutput == null) {
            call.reject("Belum ada file tujuan", "NOT_STARTED");
            return;
        }

        io.execute(() -> {
            try {
                byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
                pendingOutput.write(bytes);
                pendingBytes += bytes.length;
                JSObject ret = new JSObject();
                ret.put("bytes", pendingBytes);
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                // Jangan tutup stream di sini: JS akan memanggil abort/finish.
                getActivity().runOnUiThread(() -> call.reject(
                    "Gagal menulis file: " + e.getMessage(), e));
            }
        });
    }

    @PluginMethod
    public void finish(PluginCall call) {
        if (pendingOutput == null) {
            call.reject("Belum ada file tujuan", "NOT_STARTED");
            return;
        }

        io.execute(() -> {
            try {
                long written = pendingBytes;
                pendingOutput.flush();
                pendingOutput.close();
                pendingOutput = null;

                JSObject ret = new JSObject();
                ret.put("bytes", written);
                ret.put("uri", pendingUri != null ? pendingUri.toString() : "");
                ret.put("name", pendingName != null ? pendingName : "");
                pendingBytes = 0;
                pendingUri = null;
                pendingName = null;
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                closeQuietly();
                clearPending();
                getActivity().runOnUiThread(() -> call.reject(
                    "Gagal menyelesaikan file: " + e.getMessage(), e));
            }
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        io.execute(() -> {
            closeQuietly();
            clearPending();
            call.resolve();
        });
    }

    private String resolveDisplayName(Uri uri) {
        String displayName = pendingName;
        try (Cursor cursor = getContext().getContentResolver().query(
            uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) displayName = cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Nama dari file manager bersifat opsional.
        }
        return displayName;
    }

    private void closeQuietly() {
        if (pendingOutput != null) {
            try {
                pendingOutput.close();
            } catch (Exception ignored) {
                // Berkas sudah tidak bisa ditulis; tidak ada yang bisa dipulihkan.
            }
            pendingOutput = null;
        }
    }

    private void clearPending() {
        pendingUri = null;
        pendingName = null;
        pendingBytes = 0;
    }
}
