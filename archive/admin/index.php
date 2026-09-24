<?php
// Trip Angkutan Admin Dashboard - CodeIgniter 2.2.4 Style

$api_base = "http://localhost:3000/api";
$admin_token = isset($_COOKIE['admin_token']) ? $_COOKIE['admin_token'] : null;
$page = isset($_GET['page']) ? $_GET['page'] : 'dashboard';

if ($page === 'logout') {
    setcookie('admin_token', '', time() - 3600);
    header('Location: index.php');
    exit;
}

function api_call($endpoint, $method = 'GET', $data = null, $token = null) {
    global $api_base;
    $url = $api_base . $endpoint;
    $headers = ['Content-Type: application/json'];
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    if ($method === 'POST' || $method === 'PUT' || $method === 'DELETE') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        if ($data) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $http_code, 'data' => json_decode($response, true)];
}

if (!$admin_token) {
    $login = api_call('/auth/admin-login', 'POST', ['username' => 'admin', 'password' => 'admin123']);
    if ($login['code'] === 200 && isset($login['data']['token'])) {
        $admin_token = $login['data']['token'];
        setcookie('admin_token', $admin_token, time() + 86400);
    }
}

$trips = [];
$tariffs = [];
$officers = [];
$server_online = false;

$health = api_call('/health', 'GET');
if ($health['code'] === 200 && isset($health['data']['status'])) {
    $server_online = $health['data']['status'] === 'ok';
}

if ($server_online && $admin_token) {
    // Get detailed trips from reports endpoint
    $r = api_call('/reports/trips', 'GET', null, $admin_token);
    if ($r['code'] === 200 && is_array($r['data'])) $trips = $r['data'];
    
    $r = api_call('/tariffs', 'GET', null, $admin_token);
    if ($r['code'] === 200 && is_array($r['data'])) $tariffs = $r['data'];
    
    $r = api_call('/officers', 'GET', null, $admin_token);
    if ($r['code'] === 200 && is_array($r['data'])) $officers = $r['data'];
}

$total_trips = count($trips);
$total_vehicles = 0;
$total_revenue = 0;
$trip_muatan = 0;
foreach ($trips as $t) {
    $total_vehicles += count($t['vehicles'] ?? []);
    $total_revenue += $t['trip_revenue'] ?? 0;
    if (($t['status_muatan'] ?? '') === 'muatan') $trip_muatan++;
}

$total_officers = count($officers);
$aktif_officers = count(array_filter($officers, function($o) { return !empty($o['is_active']); }));

function fmtRp($n) { return 'Rp ' . number_format($n, 0, ',', '.'); }
function getInitials($name) {
    $words = explode(' ', $name);
    $init = '';
    foreach ($words as $w) { $init .= strtoupper(substr($w, 0, 1)); }
    return $init;
}
function getAvatarColor($name) {
    $colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500'];
    return $colors[ord($name[0]) % count($colors)];
}
function getGolonganBadge($gol) {
    if (strpos($gol, 'Internal') !== false) return '<span class="badge badge-blue">Internal</span>';
    if (strpos($gol, 'Berganji') !== false) return '<span class="badge badge-amber">Ekst. Berganji</span>';
    if (strpos($gol, 'Tanpa') !== false) return '<span class="badge badge-red">Ekst. Tanpa Garansi</span>';
    return '<span class="badge badge-gray">' . htmlspecialchars($gol) . '</span>';
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trip Angkutan - Admin Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', sans-serif; }
        .sidebar { width: 260px; min-height: 100vh; background: #0F172A; position: fixed; left: 0; top: 0; bottom: 0; display: flex; flex-direction: column; }
        .nav-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 10px; color: #94A3B8; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; text-decoration: none; margin-bottom: 4px; }
        .nav-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .nav-item.active { background: #3B82F6; color: #fff; }
        .main-content { margin-left: 260px; min-height: 100vh; background: #F8FAFC; }
        .metric-card { background: white; border-radius: 16px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .metric-label { font-size: 11px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
        .metric-value { font-size: 26px; font-weight: 800; color: #0F172A; line-height: 1; }
        .badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; }
        .badge-success { background: #D1FAE5; color: #059669; }
        .badge-warning { background: #FEF3C7; color: #D97706; }
        .badge-blue { background: #DBEAFE; color: #2563EB; }
        .badge-red { background: #FEE2E2; color: #DC2626; }
        .badge-amber { background: #FEF3C7; color: #D97706; }
        .badge-gray { background: #F1F5F9; color: #64748B; }
        .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.2s; border: none; }
        .btn-primary { background: #3B82F6; color: white; }
        .btn-primary:hover { background: #2563EB; }
        .btn-secondary { background: #F1F5F9; color: #334155; }
        .btn-secondary:hover { background: #E2E8F0; }
        .server-status { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
        .server-status.online { background: #D1FAE5; color: #059669; }
        .server-status.offline { background: #FEE2E2; color: #DC2626; }
        .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
        .card-header { padding: 14px 20px; border-bottom: 1px solid #F1F5F9; display: flex; justify-content: space-between; align-items: center; }
        .card-title { font-size: 13px; font-weight: 700; color: #0F172A; text-transform: uppercase; letter-spacing: 0.05em; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #F8FAFC; padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #E2E8F0; }
        td { padding: 12px 14px; border-bottom: 1px solid #F1F5F9; font-size: 13px; color: #334155; }
        tr:hover td { background: #F8FAFC; }
        .trip-row { cursor: pointer; }
        .trip-row:hover td { background: #EFF6FF; }
        .trip-row.expanded td { background: #EFF6FF; }
        .expand-icon { transition: transform 0.2s; display: inline-block; }
        .trip-row.expanded .expand-icon { transform: rotate(90deg); }
        .detail-row { display: none; }
        .detail-row.show { display: table-row; }
        .detail-cell { padding: 0 !important; background: #EFF6FF; }
        .detail-inner { padding: 16px 20px; }
        .vehicle-item { display: flex; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px solid #E2E8F0; }
        .vehicle-item:last-child { border-bottom: none; }
        .vehicle-plate { font-family: monospace; font-weight: 700; min-width: 100px; }
        .vehicle-type { min-width: 80px; }
        .vehicle-actions { display: flex; gap: 6px; align-items: center; }
        .empty-state { text-align: center; padding: 48px; color: #94A3B8; }
    </style>
    <script>
        function toggleDetail(id) {
            const row = document.getElementById('trip-' + id);
            const detail = document.getElementById('detail-' + id);
            if (row && detail) {
                row.classList.toggle('expanded');
                detail.classList.toggle('show');
            }
        }
    </script>
</head>
<body class="bg-slate-50">
    <!-- Sidebar -->
    <aside class="sidebar">
        <div class="p-5 border-b border-white/10">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-xl">🚛</div>
                <div>
                    <div class="text-white font-bold text-base">Trip Angkutan</div>
                    <div class="text-slate-400 text-xs">Admin Dashboard</div>
                </div>
            </div>
        </div>
        <nav class="p-3 flex-1">
            <a href="?page=dashboard" class="nav-item <?= $page === 'dashboard' ? 'active' : '' ?>">📊 Dashboard</a>
            <a href="?page=tariffs" class="nav-item <?= $page === 'tariffs' ? 'active' : '' ?>">💰 Master Tarif</a>
            <a href="?page=plates" class="nav-item <?= $page === 'plates' ? 'active' : '' ?>">🚗 Master Plat</a>
            <a href="?page=officers" class="nav-item <?= $page === 'officers' ? 'active' : '' ?>">👥 Petugas</a>
            <a href="?page=reports" class="nav-item <?= $page === 'reports' ? 'active' : '' ?>">📈 Laporan</a>
            <a href="?page=settings" class="nav-item <?= $page === 'settings' ? 'active' : '' ?>">⚙️ Pengaturan</a>
        </nav>
        <div class="p-3 border-t border-white/10">
            <a href="?page=logout" class="nav-item text-red-400">🚪 Logout</a>
        </div>
    </aside>

    <!-- Main -->
    <main class="main-content">
        <header class="bg-white px-6 py-3 border-b border-slate-200 flex justify-between items-center">
            <h1 class="text-lg font-bold text-slate-900">
                <?= $page === 'dashboard' ? 'Dashboard' : ($page === 'tariffs' ? 'Master Tarif' : ($page === 'officers' ? 'Kelola Petugas' : ($page === 'reports' ? 'Laporan' : 'Pengaturan'))) ?>
            </h1>
            <div class="flex items-center gap-3">
                <div class="server-status <?= $server_online ? 'online' : 'offline' ?>">
                    <span class="w-2 h-2 rounded-full bg-current"></span>
                    <?= $server_online ? 'Tersambung' : 'Terputus' ?>
                </div>
                <div class="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center text-white font-bold text-xs">AD</div>
            </div>
        </header>

        <div class="p-6">
            <?php if ($page === 'dashboard'): ?>
            <!-- Dashboard -->
            <div class="grid grid-cols-4 gap-4 mb-6">
                <div class="metric-card"><div class="metric-label">Total Trip</div><div class="metric-value"><?= $total_trips ?></div></div>
                <div class="metric-card"><div class="metric-label">Trip Muatan</div><div class="metric-value text-emerald-600"><?= $trip_muatan ?></div></div>
                <div class="metric-card"><div class="metric-label">Total Kendaraan</div><div class="metric-value"><?= $total_vehicles ?></div></div>
                <div class="metric-card"><div class="metric-label">Pendapatan</div><div class="metric-value text-emerald-600" style="font-size:18px"><?= fmtRp($total_revenue) ?></div></div>
            </div>
            <div class="card">
                <div class="card-header">
                    <div class="card-title">Trip Terbaru</div>
                    <button onclick="location.reload()" class="btn btn-secondary">🔄 Refresh</button>
                </div>
                <table>
                    <thead><tr><th>No Trip</th><th>Petugas</th><th>Rute</th><th>Status</th><th>Kendaraan</th><th>Tanggal</th></tr></thead>
                    <tbody>
                        <?php if (empty($trips)): ?>
                        <tr><td colspan="6" class="empty-state">📭 Belum ada trip</td></tr>
                        <?php else: foreach (array_slice($trips, 0, 10) as $t): ?>
                        <tr>
                            <td class="font-mono font-bold"><?= htmlspecialchars($t['no_trip'] ?? $t['id']) ?></td>
                            <td><?= htmlspecialchars($t['officer_name'] ?? '-') ?></td>
                            <td><?= htmlspecialchars(($t['route_from'] ?? '-') . ' → ' . ($t['route_to'] ?? '-')) ?></td>
                            <td><?= ($t['status_muatan'] ?? '') === 'muatan' ? '<span class="badge badge-success">Ada Muatan</span>' : '<span class="badge badge-warning">Kosong</span>' ?></td>
                            <td><?= count($t['vehicles'] ?? []) ?></td>
                            <td class="text-slate-500"><?= isset($t['created_at']) ? date('d/m/Y H:i', strtotime($t['created_at'])) : '-' ?></td>
                        </tr>
                        <?php endforeach; endif; ?>
                    </tbody>
                </table>
            </div>

            <?php elseif ($page === 'tariffs'): ?>
            <!-- Tarif -->
            <div class="card">
                <div class="card-header"><div class="card-title">Daftar Tarif Kendaraan</div><button class="btn btn-primary">+ Tambah</button></div>
                <table>
                    <thead><tr><th>Golongan</th><th>Jenis</th><th>Tarif Muatan</th><th>Tarif Kosong</th><th>Aksi</th></tr></thead>
                    <tbody>
                        <?php if (empty($tariffs)): ?>
                        <tr><td colspan="5" class="empty-state">💰 Belum ada tarif</td></tr>
                        <?php else: foreach ($tariffs as $t): ?>
                        <tr>
                            <td class="font-bold"><?= htmlspecialchars($t['golongan'] ?? '-') ?></td>
                            <td><?= htmlspecialchars($t['vehicle_type'] ?? '-') ?></td>
                            <td class="font-bold text-emerald-600"><?= ($t['loaded_tariff'] ?? 0) > 0 ? fmtRp($t['loaded_tariff']) : '-' ?></td>
                            <td><?= ($t['empty_tariff'] ?? 0) > 0 ? fmtRp($t['empty_tariff']) : '-' ?></td>
                            <td><button class="btn btn-secondary">✏️</button></td>
                        </tr>
                        <?php endforeach; endif; ?>
                    </tbody>
                </table>
            </div>

            <?php elseif ($page === 'officers'): ?>
            <!-- Petugas -->
            <div class="grid grid-cols-3 gap-4 mb-6">
                <div class="metric-card"><div class="metric-label">Total</div><div class="metric-value"><?= $total_officers ?></div></div>
                <div class="metric-card"><div class="metric-label">Aktif</div><div class="metric-value text-emerald-600"><?= $aktif_officers ?></div></div>
                <div class="metric-card"><div class="metric-label">Nonaktif</div><div class="metric-value text-red-600"><?= $total_officers - $aktif_officers ?></div></div>
            </div>
            <div class="card">
                <div class="card-header"><div class="card-title">Daftar Petugas</div><button class="btn btn-primary">+ Tambah</button></div>
                <table>
                    <thead><tr><th>Petugas</th><th>Region</th><th>PIN</th><th>Status</th><th>Aksi</th></tr></thead>
                    <tbody>
                        <?php if (empty($officers)): ?>
                        <tr><td colspan="5" class="empty-state">👥 Belum ada petugas</td></tr>
                        <?php else: foreach ($officers as $o):
                            $name = $o['name'] ?? 'Unknown';
                            $init = getInitials($name);
                            $color = getAvatarColor($name);
                            $is_active = !empty($o['is_active']);
                        ?>
                        <tr>
                            <td>
                                <div class="flex items-center gap-3">
                                    <div class="w-9 h-9 rounded-full <?= $color ?> flex items-center justify-center text-white font-bold text-xs"><?= $init ?></div>
                                    <span class="font-bold"><?= htmlspecialchars($name) ?></span>
                                </div>
                            </td>
                            <td><span class="badge badge-blue"><?= htmlspecialchars($o['region_code'] ?? '-') ?></span></td>
                            <td class="text-slate-400 font-mono">••••••</td>
                            <td><?= $is_active ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-red">Nonaktif</span>' ?></td>
                            <td><button class="btn btn-secondary">✏️ Edit</button></td>
                        </tr>
                        <?php endforeach; endif; ?>
                    </tbody>
                </table>
            </div>

            <?php elseif ($page === 'reports'): ?>
            <!-- Laporan with Expandable Details -->
            <div class="card">
                <div class="card-header">
                    <div class="card-title">Detail Trip</div>
                    <button onclick="location.reload()" class="btn btn-secondary">🔄 Refresh</button>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:40px"></th>
                            <th>No Trip</th>
                            <th>Petugas</th>
                            <th>Rute</th>
                            <th>Kendaraan</th>
                            <th>Tanggal</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($trips)): ?>
                        <tr><td colspan="6" class="empty-state">📈 Belum ada data trip</td></tr>
                        <?php else: foreach ($trips as $t): 
                            $trip_id = $t['id'];
                            $vehicles = $t['vehicles'] ?? [];
                        ?>
                        <!-- Main Row -->
                        <tr class="trip-row" id="trip-<?= $trip_id ?>" onclick="toggleDetail('<?= $trip_id ?>')">
                            <td class="text-slate-400"><span class="expand-icon">▶</span></td>
                            <td class="font-mono font-bold"><?= htmlspecialchars($t['no_trip'] ?? $trip_id) ?></td>
                            <td><?= htmlspecialchars($t['officer_name'] ?? '-') ?></td>
                            <td><?= htmlspecialchars(($t['route_from'] ?? '-') . ' → ' . ($t['route_to'] ?? '-')) ?></td>
                            <td><span class="badge <?= ($t['status_muatan'] ?? '') === 'muatan' ? 'badge-success' : 'badge-warning' ?>"><?= count($vehicles) ?> Unit</span></td>
                            <td class="text-slate-500"><?= isset($t['created_at']) ? date('d/m/Y H:i', strtotime($t['created_at'])) : '-' ?></td>
                        </tr>
                        <!-- Detail Row -->
                        <tr class="detail-row" id="detail-<?= $trip_id ?>">
                            <td colspan="6" class="detail-cell">
                                <div class="detail-inner">
                                    <div class="grid grid-cols-4 gap-4 mb-4">
                                        <div><span class="text-xs text-slate-500">Kategori</span><br><span class="badge badge-blue"><?= htmlspecialchars($t['keterangan'] ?? '-') ?></span></div>
                                        <div><span class="text-xs text-slate-500">Region</span><br><span class="font-bold"><?= htmlspecialchars($t['region_name'] ?? '-') ?></span></div>
                                        <div><span class="text-xs text-slate-500">Tanggal</span><br><span class="font-bold"><?= isset($t['created_at']) ? date('d M Y, H:i', strtotime($t['created_at'])) : '-' ?></span></div>
                                        <div><span class="text-xs text-slate-500">Total Tarif</span><br><span class="font-bold text-emerald-600"><?= fmtRp($t['trip_revenue'] ?? 0) ?></span></div>
                                    </div>
                                    
                                    <div class="bg-white rounded-xl p-4 border border-slate-200">
                                        <div class="text-xs font-bold text-slate-500 uppercase mb-3">Kendaraan (<?= count($vehicles) ?> Unit)</div>
                                        <?php if (empty($vehicles)): ?>
                                        <p class="text-slate-400 text-sm">Tidak ada data kendaraan</p>
                                        <?php else: foreach ($vehicles as $v): ?>
                                        <div class="vehicle-item">
                                            <div class="vehicle-plate text-slate-700"><?= htmlspecialchars($v['no_polisi'] ?? '-') ?></div>
                                            <div class="vehicle-type text-slate-600"><?= htmlspecialchars($v['vehicle_type'] ?? '-') ?></div>
                                            <div><?= getGolonganBadge($v['golongan'] ?? '') ?></div>
                                            <div>
                                                <?= !empty($v['has_load']) ? '<span class="badge badge-success">Ada Muatan</span>' : '<span class="badge badge-gray">Kosong</span>' ?>
                                            </div>
                                            <div class="flex-1"></div>
                                            <div class="font-bold text-emerald-600"><?= fmtRp($v['tariff_amount'] ?? 0) ?></div>
                                        </div>
                                        <?php endforeach; endif; ?>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        <?php endforeach; endif; ?>
                    </tbody>
                </table>
            </div>

            <?php else: ?>
            <!-- Settings -->
            <div class="card p-12 text-center">
                <div class="text-5xl mb-4">⚙️</div>
                <p class="text-slate-500">Fitur dalam development</p>
                <div class="mt-6 p-6 bg-slate-50 rounded-xl inline-block text-left">
                    <p class="text-sm text-slate-600">Server: <?= $server_online ? '<span class="text-emerald-600">Tersambung</span>' : '<span class="text-red-600">Terputus</span>' ?></p>
                    <p class="text-sm text-slate-600">Total Trip: <?= $total_trips ?></p>
                    <p class="text-sm text-slate-600">Total Petugas: <?= $total_officers ?></p>
                </div>
            </div>
            <?php endif; ?>
        </div>
    </main>
</body>
</html>