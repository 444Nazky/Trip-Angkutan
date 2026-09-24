<?php
// Trip Angkutan Admin Dashboard entry point
$static_path = __DIR__ . '/index.html';
if (file_exists($static_path)) {
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: text/html; charset=utf-8');
    $html = file_get_contents($static_path);
    $html = str_replace('<html', '<html data-admin', $html);
    echo $html;
    exit;
}
http_response_code(404);
echo "Build not found. Run: npm run build";
