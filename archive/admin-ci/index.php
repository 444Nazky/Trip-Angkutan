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
        '<link rel="icon" type="image/svg+xml" href="assets/karyamasv.svg">',
        $html
    );

    // Guard scroll: alur dokumen tetap bisa digulir bahkan sebelum CSS bundle termuat
    $html = str_replace(
        '<head>',
        '<head><style>html[data-admin],html[data-admin] body{position:static!important;overflow:visible!important;height:auto!important;max-height:none!important;}</style>',
        $html
    );

    echo $html;
    exit;
}
http_response_code(404);
echo "Build not found. Run: npm run build";
