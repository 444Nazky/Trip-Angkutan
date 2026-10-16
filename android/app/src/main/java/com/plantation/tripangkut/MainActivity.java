package com.plantation.tripangkut;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // WAJIB dipanggil SEBELUM super.onCreate(): bridge Capacitor dibangun di
        // dalam super.onCreate() (BridgeActivity.load()), jadi plugin yang
        // didaftarkan setelahnya tidak akan pernah ikut terpasang dan
        // `ApkInstaller.install()` gagal dengan "not implemented".
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
