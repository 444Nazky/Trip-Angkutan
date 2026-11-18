package com.plantation.tripangkut;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

/**
 * Jembatan JS → BiometricPrompt Android.
 *
 * WebAuthn di WebView belum tentu tersedia, sehingga permintaan sidik jari dari
 * halaman web bisa langsung gagal dan petugas selalu jatuh ke PIN. Plugin ini
 * memunculkan dialog sidik jari bawaan Android (BiometricPrompt) supaya
 * verifikasi benar-benar memakai sensor perangkat.
 */
@CapacitorPlugin(name = "NativeBiometric")
public class NativeBiometricPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            int result = BiometricManager.from(getContext())
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            ret.put("available", result == BiometricManager.BIOMETRIC_SUCCESS);
            ret.put("reason", result);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("available", false);
            ret.put("reason", "error");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void verify(PluginCall call) {
        try {
            FragmentActivity activity = (FragmentActivity) getActivity();
            if (activity == null) {
                call.reject("Aktivitas tidak tersedia", "UNAVAILABLE");
                return;
            }

            Executor executor = ContextCompat.getMainExecutor(getContext());
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                executor,
                new BiometricPrompt.AuthenticationCallback() {
                    private boolean finished = false;

                    private void finishOk() {
                        if (finished) return;
                        finished = true;
                        JSObject ret = new JSObject();
                        ret.put("verified", true);
                        call.resolve(ret);
                    }

                    private void finishFail(String message, String code) {
                        if (finished) return;
                        finished = true;
                        call.reject(message, code);
                    }

                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        finishOk();
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        String code = (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                            || errorCode == BiometricPrompt.ERROR_USER_CANCELED
                            || errorCode == BiometricPrompt.ERROR_CANCELED)
                            ? "CANCELLED"
                            : "FAILED";
                        finishFail(errString.toString(), code);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // Jari tidak cocok: BiometricPrompt tetap terbuka agar
                        // petugas bisa mencoba lagi, jadi jangan reject dulu.
                    }
                }
            );

            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(call.getString("title", "Verifikasi Sidik Jari"))
                .setSubtitle(call.getString("subtitle", "Sebelum data trip dikirim ke server"))
                .setDescription(call.getString("description", "Sentuh sensor sidik jari untuk melanjutkan."))
                .setNegativeButtonText(call.getString("negativeButtonText", "Batal"))
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .build();

            activity.runOnUiThread(() -> prompt.authenticate(info));
        } catch (Exception e) {
            call.reject("Gagal menampilkan sidik jari: " + e.getMessage(), "FAILED", e);
        }
    }
}
