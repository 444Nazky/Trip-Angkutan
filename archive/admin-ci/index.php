<?php
// Trip Angkutan Admin Dashboard entry point (CodeIgniter web app — bukan aplikasi Ionic)
$static_path = __DIR__ . '/index.html';
if (file_exists($static_path)) {
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: text/html; charset=utf-8');
    $html = file_get_contents($static_path);
    $html = str_replace('<html', '<html data-admin', $html);

    // Dashboard memakai ikon lucide-react — ganti tag ikon/favicon bawaan build Ionic
    // dengan ikon kosong eksplisit supaya browser tidak lagi minta /favicon.ico
    $html = preg_replace(
        '/<link\s+rel="(?:icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)"[^>]*>\s*/i',
        '<link rel="icon" href="data:,">',
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
