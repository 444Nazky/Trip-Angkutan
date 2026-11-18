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

/**
 * Simpan file lewat file manager Android.
 *
 * ACTION_CREATE_DOCUMENT membuka pemilih lokasi bawaan Android. Pengguna bebas
 * memilih folder (Download, WhatsApp, dokumen, dsb.) dan aplikasi hanya
 * menulis ke URI yang dipilih, tanpa meminta izin penyimpanan luas.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    private String pendingFilename;
    private String pendingData;

    @PluginMethod
    public void saveJson(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        if (filename == null || filename.trim().isEmpty()) {
            call.reject("Nama file wajib diisi");
            return;
        }
        if (data == null) {
            call.reject("Isi file wajib diisi");
            return;
        }

        pendingFilename = filename.trim();
        pendingData = data;

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, pendingFilename);
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

        final String json = pendingData;
        final String filename = pendingFilename;
        clearPending();

        new Thread(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("Tidak bisa membuka lokasi simpan");
                output.write(json.getBytes(StandardCharsets.UTF_8));
                output.flush();

                String displayName = filename;
                try (Cursor cursor = getContext().getContentResolver().query(
                    uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (index >= 0) displayName = cursor.getString(index);
                    }
                } catch (Exception ignored) {
                    // Nama dari file manager bersifat opsional.
                }

                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                ret.put("name", displayName);
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(
                    "Gagal menyimpan file: " + e.getMessage(), e));
            }
        }).start();
    }

    private void clearPending() {
        pendingFilename = null;
        pendingData = null;
    }
}
