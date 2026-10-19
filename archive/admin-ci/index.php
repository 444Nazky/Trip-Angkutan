<?php
// Trip Angkutan Admin Dashboard entry point (CodeIgniter web app — bukan aplikasi Ionic)
$static_path = __DIR__ . '/index.html';
if (file_exists($static_path)) {
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: text/html; charset=utf-8');
    // Hot-reload: index.html tidak boleh di-cache browser, supaya refresh
    // selalu memuat bundle terbaru (nama file ber-hash berubah tiap build)
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    $html = file_get_contents($static_path);
    // Build admin kini sudah membawa atribut data-admin dari src/index.html
    // (wajib untuk deploy statis/Netlify). Sisipkan hanya bila belum ada,
    // supaya tidak dobel saat disajikan lewat php -S.
    if (strpos($html, 'data-admin') === false) {
        $html = str_replace('<html', '<html data-admin', $html);
    }

    // Ikon situs: pakai brand karyamasv.svg (aset lokal admin-ci/assets) —
    // menggantikan tag ikon bawaan build Ionic sekaligus mencegah 404 /favicon.ico
    $html = preg_replace(
        '/<link\s+rel="(?:icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)"[^>]*>\s*/i',
        // Huruf besar "Assets" penting: build menaruh berkasnya di sana, dan
        // filesystem Linux peka huruf besar/kecil (dulu → favicon 404).
        '<link rel="icon" type="image/svg+xml" href="Assets/karyamasv.svg">',
        $html
    );

    // Guard scroll: alur dokumen tetap bisa digulir bahkan sebelum CSS bundle termuat
    $html = str_replace(
        '<head>',
        '<head><style>html[data-admin],html[data-admin] body{position:static!important;overflow:visible!important;height:auto!important;max-height:none!important;}</style>',
        $html
    );

    // Endpoint API mengikuti HOST yang dipakai membuka dashboard ini.
    // Build admin (vite PROD) hanya mengenal Railway, sehingga dashboard yang
    // dibuka lewat LAN (mis. 10.x.x.x:8000) akan menembak server produksi —
    // padahal di intranet yang benar adalah backend LAN yang sama, tempat HP
    // petugas juga menulis. Override ditulis SEKALI per-origin (localStorage
    // di-scope per host:port), jadi bila IP LAN berubah origin-nya baru lagi
    // dan nilainya ikut benar sendiri. Pilihan manual admin di menu Pengaturan
    // Server tetap menang karena nilai yang sudah ada tidak ditimpa.
    $api_host = preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($api_host !== '') {
        $api_base = 'http://' . $api_host . ':3000/api';
        $boot = '<script>(function(){try{var k="trip.admin.apiBaseUrl";'
            . 'if(!localStorage.getItem(k)){localStorage.setItem(k,' . json_encode($api_base) . ');}'
            . '}catch(e){}})();</script>';
        $html = str_replace('<head>', '<head>' . $boot, $html);
    }

    echo $html;
    exit;
}
http_response_code(404);
echo "Build not found. Run: npm run build";
