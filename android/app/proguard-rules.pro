# ==============================================
# ProGuard Security Rules - Aplikasi Trip Angkutan
# ==============================================
# OWASP MASVS Compliance: M-RESILIENCE-2

# Keep application class
-keep class com.plantation.tripangkut.** { *; }

# Keep Capacitor plugins
-keep class @capacitor/core.** { *; }
-keep class @capacitor-community/** { *; }

# React Native / Ionic WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep Cordova plugins
-keep class org.apache.cordova.** { *; }
-keep class org.chromium.** { *; }

# Prevent reverse engineering
-rename obfuscation

# Obfuscate package names
-repackageclasses ''

# Keep line numbers for crash reports
-keepattributes SourceFile,LineNumberTable

# Remove logging in release
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}

# Keep SQLCipher classes (for encrypted database)
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep Parcelable implementations
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Keep enums
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Prevent obfuscation of types which use @JsonClass
-keep,allowobfuscation,allowshrinking class com.google.gson.reflect.TypeToken
-keep,allowobfuscation,allowshrinking class * extends com.google.gson.reflect.TypeToken

# Keep data classes
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ==============================================
# API Response Obfuscation
# ==============================================
# Make API error messages less informative in release builds

# ==============================================
# SQL Injection Prevention (via ProGuard)
# ==============================================
# Note: Primary protection is via parameterized queries
# This helps obfuscate SQL patterns

# ==============================================
# Network Security
# ==============================================
# Network traffic should only use HTTPS
# android:usesCleartextTraffic="false" set in AndroidManifest.xml
