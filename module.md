PANDUAN PENGGUNAAN APLIKASI TRIP ANGKUTAN

Dokumen ini menjelaskan cara menggunakan Aplikasi Trip Angkutan dari dua sisi, yaitu aplikasi mobile yang dipakai petugas lapangan dan dashboard admin yang dipakai admin kantor. Aplikasi mobile berfungsi mencatat trip kendaraan, mengambil foto dokumentasi, memvalidasi lokasi petugas, dan mengirim data ke server. Dashboard admin berfungsi memantau trip, mengelola tarif, plat, rute, dermaga, petugas, laporan, dan pembatalan trip.

Aplikasi mobile dirancang untuk kondisi lapangan dengan koneksi terbatas. Data trip disimpan lebih dulu di perangkat, lalu dikirim otomatis ke server saat koneksi tersedia. Karena itu petugas tetap bisa bekerja walaupun sedang offline, selama data master sudah pernah disinkronkan ke perangkat.

Istilah yang dipakai dalam panduan ini perlu dipahami agar tidak tertukar. Trip adalah satu perjalanan yang dicatat petugas. Status muatan trip adalah kondisi trip secara keseluruhan, yaitu Kosong atau Ada Muatan. Kondisi kendaraan adalah kondisi satu unit kendaraan, yaitu Muatan atau Kosong. Golongan adalah golongan tarif kendaraan I sampai V yang berasal dari master tarif. Kategori adalah kategori operasional kendaraan, yaitu Internal, Lokal, atau Eksternal. Region atau wilayah adalah wilayah kerja yang sudah ditetapkan sistem. Dermaga adalah titik bongkar muat di dalam suatu wilayah. Rute adalah jalur perjalanan dari satu kode lokasi ke kode lokasi lain. Geofence adalah batas area berbentuk radius di sekitar titik lokasi yang dipakai aplikasi untuk memastikan petugas benar-benar berada di area bertugas.


BAGIAN 1: APLIKASI MOBILE (PETUGAS LAPANGAN)

1. Tentang Aplikasi Mobile

Aplikasi mobile digunakan petugas untuk mencatat trip baru beserta rute, kendaraan, dan foto dokumentasi. Foto wajib diambil langsung dari kamera, tidak bisa dipilih dari galeri. Aplikasi juga memastikan petugas berada di area bertugas melalui GPS dan geofence, menyimpan data secara lokal saat offline, mengirim data otomatis saat online, menampilkan riwayat trip, dan memungkinkan pergantian petugas pada perangkat yang dipakai bersama.

Sebelum memakai aplikasi, siapkan HP Android dengan aplikasi Trip Angkutan yang sudah terpasang, akses WiFi intranet kantor untuk login pertama dan sinkronisasi data awal, ID Petugas dan PIN dari admin, izin lokasi dan kamera pada HP, serta ruang penyimpanan yang cukup karena foto trip disimpan di perangkat.

Login pertama wajib dilakukan saat perangkat terhubung ke jaringan intranet atau server kantor. Tujuannya agar aplikasi dapat mengunduh data master berupa rute, geofence, tarif, akses dermaga, dan daftar petugas ke penyimpanan lokal. Setelah data master tersimpan, aplikasi dapat dipakai untuk trip berikutnya walaupun sedang offline.


2. Login dan Konfigurasi Server

2.1 Mengecek Alamat Server

Sebelum login, pastikan alamat server yang dipakai aplikasi sudah benar. Pada halaman login, ketuk ikon gerigi atau Pengaturan Server di bagian kanan atas. Panel Pengaturan Server akan terbuka dan menampilkan pilihan server yang tersedia serta kolom URL manual.

Pilih salah satu pilihan server yang diberikan admin, atau ketik URL manual dengan format seperti http://192.168.1.123:3000/api. Ketuk Tes Koneksi untuk memastikan server dapat dihubungi. Jika hasil tes menyatakan tersambung, ketuk Simpan dan Terapkan. Jika server tidak merespons, periksa kembali alamat, koneksi WiFi, dan pastikan server kantor sedang menyala.

Panel server memiliki beberapa tombol. Simpan dan Terapkan berfungsi menyimpan alamat setelah dicek koneksinya. Tes Koneksi berfungsi menguji apakah server menjawab tanpa menyimpan. Reset ke Default mengembalikan alamat ke bawaan aplikasi. Simpan tanpa tes menyimpan alamat walaupun tes gagal, dan hanya boleh dipakai jika URL sudah dipastikan benar oleh admin.

Jika alamat server salah, aplikasi bisa terlihat online tetapi data tidak ditemukan. Pastikan alamat yang dipakai sama dengan alamat yang diberikan admin.

(Sisipkan tangkapan layar: halaman login dengan panah menunjuk ikon gerigi di kanan atas.)

(Sisipkan tangkapan layar: panel Pengaturan Server beserta pilihan endpoint dan tombol Tes Koneksi.)

2.2 Cara Login

Pada kolom ID Petugas, masukkan ID petugas yang diberikan admin. ID dapat berupa ID petugas, nama, atau username sesuai data di dashboard. Pada kolom PIN, masukkan PIN petugas. Ketuk ikon mata untuk menampilkan atau menyembunyikan PIN, lalu ketuk tombol Masuk.

Status koneksi ditampilkan di atas formulir. Online berarti perangkat terhubung ke jaringan. Offline Mode berarti perangkat tidak terhubung ke jaringan. Jika login berhasil, aplikasi akan menyiapkan data master dan membuka halaman Beranda.

2.3 Login Saat Offline

Aplikasi mencoba login ke server terlebih dahulu. Jika server tidak dapat dihubungi, aplikasi dapat memakai PIN lokal yang pernah tersimpan di perangkat. Login offline hanya bisa dilakukan jika petugas pernah login online di perangkat tersebut. Jika PIN lokal tidak cocok, muncul pesan agar petugas masuk online terlebih dahulu untuk menyinkronkan data petugas.

Jika server menolak kredensial karena PIN salah, petugas nonaktif, atau petugas tidak terdaftar, aplikasi menampilkan pesan dari server. Login offline tidak dipakai untuk menutupi penolakan tersebut.

2.4 Arti Pesan Error Saat Login

Jika muncul pesan ID petugas dan PIN harus diisi, berarti masih ada kolom yang kosong. Jika muncul pesan username atau password salah, PIN atau ID tidak cocok, sehingga perlu memeriksa PIN atau meminta reset PIN ke admin. Jika muncul pesan petugas tidak terdaftar, data petugas belum ada di server dan admin perlu menambahkannya di Master Petugas. Jika muncul pesan petugas nonaktif, status petugas di dashboard adalah Nonaktif dan admin perlu mengaktifkannya kembali.

Jika muncul pesan server tidak terjangkau dan PIN lokal tidak cocok, server sedang mati atau jaringan terputus, sehingga perangkat perlu disambungkan ke intranet lalu login online. Jika muncul pesan akun atau PIN tidak tersedia di perangkat ini, perangkat belum pernah login online dan harus login online terlebih dahulu.

2.5 Region Terkunci pada Perangkat

Setelah login pertama, perangkat akan terkunci ke region petugas. Region ini tampil di halaman Profil dengan label Region Locked. Petugas tidak bisa memilih region lain dari aplikasi. Untuk memindahkan perangkat ke region lain, diperlukan reset data perangkat oleh admin. Karena itu, pastikan petugas yang login pertama di perangkat adalah petugas yang memang akan bertugas di region tersebut.


3. Mengenal Menu Utama

Setelah login, tersedia empat menu di bagian bawah aplikasi. Menu Beranda berfungsi memulai trip baru, memantau sinkronisasi, melihat statistik, dan melihat trip terakhir. Menu Riwayat berfungsi melihat semua trip petugas, status kirim, draft yang belum selesai, dan detail trip. Menu Server berfungsi melihat dan mengubah alamat server atau endpoint. Menu Profil berfungsi melihat akun petugas, status koneksi, pembaruan aplikasi, lokasi aktif, dan mengganti petugas.

Jika petugas sedang berada di halaman Ringkasan dan menekan menu lain, aplikasi akan menampilkan konfirmasi karena data trip belum disimpan. Pilih Batal untuk kembali mengisi trip, atau Yakin setelah hitungan mundur selesai untuk meninggalkan halaman.

(Sisipkan tangkapan layar: halaman Beranda dengan panah ke empat menu bawah.)


4. Cara Membuat Trip Baru

Alur pembuatan trip berbeda tergantung status muatan. Pada trip Kapal Kosong, petugas tidak menginput kendaraan, cukup memilih rute, mengambil foto bukti kapal kosong, lalu swafoto. Pada trip Kapal dengan Muatan, petugas menginput satu atau lebih kendaraan, masing-masing dengan foto, plat, jenis, dan kategori.

4.1 Mulai Trip dan Aturan Draft

Buka menu Beranda, lalu ketuk tombol Mulai Trip. Jika petugas memiliki akses lebih dari satu dermaga, pilih dermaga terlebih dahulu. Setelah itu pilih status muatan.

Jika sebelumnya sudah ada draft yang belum selesai, tombol Mulai Trip akan berubah menjadi dua tombol, yaitu Lanjutkan Trip untuk melanjutkan draft yang sudah ada dan Mulai Trip (terkunci) untuk menampilkan pemberitahuan bahwa petugas harus melanjutkan atau membatalkan draft terlebih dahulu.

Draft baru dianggap ada jika sudah ada minimal satu kendaraan. Untuk trip kosong, draft dihitung setelah swafoto petugas diambil. Baru memilih status muatan atau rute belum dihitung sebagai draft. Batas umur draft bawaan adalah 15 menit, dihitung sejak draft dibuat, bukan sejak terakhir diubah. Admin dapat mengubah batas ini dari dashboard. Setelah melewati batas, isian draft dibekukan dan petugas hanya bisa mengirim trip atau membatalkannya. Setiap petugas memiliki draft sendiri, sehingga perangkat yang dipakai berganti petugas tidak menampilkan draft petugas lain. Draft yang sudah dihitung muncul sebagai kartu khusus di halaman Riwayat.

(Sisipkan tangkapan layar: tombol Mulai Trip di Beranda.)

(Sisipkan tangkapan layar: pemberitahuan ketika tombol Mulai Trip terkunci karena masih ada draft.)

4.2 Memilih Dermaga Jika Memiliki Akses Ganda

Jika petugas memiliki akses ke lebih dari satu dermaga, aplikasi menampilkan halaman Pilih Dermaga. Periksa daftar dermaga yang tersedia, ketuk salah satu dermaga sampai ditandai, lalu ketuk Pilih Dermaga. Dermaga yang dipilih berlaku untuk sesi trip tersebut. Jika petugas hanya memiliki satu akses dermaga, halaman ini dilewati otomatis.

(Sisipkan tangkapan layar: halaman Pilih Dermaga dengan dua pilihan dermaga.)

4.3 Memilih Status Muatan

Pada halaman Status Muatan tersedia dua pilihan. Kapal Kosong berarti kapal berjalan tanpa muatan, sehingga alurnya adalah memilih rute, mengambil foto bukti kapal kosong, swafoto, lalu mengirim. Kapal dengan Muatan berarti kapal membawa muatan, sehingga alurnya adalah memilih rute, menginput kendaraan, swafoto, lalu mengirim.

Ketuk salah satu pilihan, lalu ketuk Lanjut Pilih Rute. Pilihan status muatan hanya bisa diubah selama draft belum kedaluwarsa. Jika draft sudah lewat batas, aplikasi langsung mengarahkan petugas ke halaman Ringkasan.

(Sisipkan tangkapan layar: halaman Status Muatan dengan pilihan Kapal Kosong dan Kapal dengan Muatan.)

4.4 Memilih Rute dan Validasi Geofence

Halaman Pilih Rute memakai GPS untuk memastikan petugas berada di area yang benar. Pastikan GPS atau lokasi HP aktif dan izin lokasi sudah diberikan. Tunggu sampai aplikasi selesai memeriksa lokasi, yang ditandai dengan tulisan Memeriksa lokasi GPS. Perhatikan banner Wilayah Aktif dan nama dermaga jika ada.

Jika petugas berada di dalam area, muncul pemberitahuan biru berisi nama titik dan rute yang sesuai lokasi. Rute yang sesuai lokasi tampil paling atas dengan label Sesuai lokasi Anda, dan aplikasi otomatis memilih rute pertama yang diizinkan. Petugas dapat memilih rute lain yang juga diizinkan. Setelah itu ketuk Lanjut Input Kendaraan untuk trip bermuatan atau Lanjut Ambil Foto untuk trip kosong.

Rute yang tidak sesuai lokasi tetap ditampilkan, tetapi dalam keadaan terkunci. Ketuk jumlah rute lain terkunci untuk melihatnya. Jika GPS belum aktif, muncul pesan agar petugas menyalakan izin lokasi. Jika petugas berada di luar area bertugas, muncul kotak merah dan petugas harus kembali ke area lalu mengetuk Cek lokasi lagi. Jika petugas berada di dermaga yang berbeda, muncul kotak kuning dan petugas harus kembali ke dermaga yang dipilih lalu mengetuk Periksa Ulang Lokasi. Jika konfigurasi geofence belum ada, muncul pesan Area bertugas belum tersedia dan petugas harus menghubungi admin. Jika rute untuk dermaga belum tersinkron, muncul pesan tidak ada rute untuk dermaga tersebut dan petugas perlu menyambungkan perangkat ke internet agar data rute terbaru diunduh.

Tombol lanjut tidak dapat ditekan jika petugas belum berada di dalam area geofence atau rute yang dipilih tidak diizinkan untuk titik lokasi tersebut. Daftar rute yang bisa dipakai ditentukan admin melalui pengaturan titik geofence pada Master Rute. Jika rute yang seharusnya muncul tidak ada, petugas harus menghubungi admin.

(Sisipkan tangkapan layar: halaman Pilih Rute saat petugas berada di dalam area, dengan rute yang diizinkan di bagian atas.)

(Sisipkan tangkapan layar: halaman Pilih Rute saat petugas berada di luar area, baik kotak merah maupun kotak kuning.)

4.5 Input Kendaraan untuk Trip dengan Muatan

Halaman Input Kendaraan memiliki empat kolom wajib, yaitu foto dokumentasi, nomor plat, jenis kendaraan, dan kategori. Penghitung empat per empat di kanan atas menunjukkan berapa kolom yang sudah lengkap.

Untuk foto dokumentasi kendaraan, ketuk Ambil foto dari kamera, arahkan kamera ke kendaraan, lalu ketuk tombol jepret. Setelah foto tersimpan, muncul thumbnail dan tanda centang. Jika foto kurang jelas, ketuk Ulangi. Foto wajib diambil dari kamera dan tidak bisa memilih dari galeri. Foto otomatis diberi watermark berisi waktu, lokasi GPS, dan region, lalu disimpan sebagai bukti dokumentasi trip.

Untuk nomor plat dan kondisi kendaraan, ketuk kolom Nomor Plat lalu ketik nomor plat kendaraan. Format plat akan dirapikan otomatis dengan huruf kapital dan spasi. Di sebelah kanan kolom plat terdapat pilihan kondisi kendaraan, yaitu Muatan atau Kosong. Setelah kolom plat selesai diisi, aplikasi memeriksa plat ke database. Jika plat terdaftar, muncul status internal, lokal, atau eksternal. Jika perangkat sedang offline, aplikasi memakai data master lokal dan menampilkan keterangan perkiraan offline.

Status plat internal berarti kendaraan internal perusahaan dan tidak ditagih atau Rp 0. Status lokal berarti kendaraan lokal di wilayah tersebut dan memakai tarif lokal region. Status eksternal berarti kendaraan dari luar wilayah dan memakai tarif eksternal region. Jika plat tidak ditemukan, petugas tetap bisa melanjutkan, tetapi pastikan nomor plat diketik dengan benar. Untuk plat internal baru, admin dapat menambahkannya di Master Plat.

Untuk jenis kendaraan, ketuk dropdown Jenis Kendaraan lalu pilih jenis yang sesuai. Daftar jenis kendaraan berasal dari Master Jenis Kendaraan di dashboard admin, sehingga pilihan di HP dan di dashboard selalu sama. Jika daftar kosong, muncul pesan agar perangkat tersambung ke server sekali untuk menarik master jenis kendaraan.

Untuk kategori kendaraan, ketuk dropdown Kategori lalu pilih Internal, Eksternal, atau Lokal. Kategori menentukan dasar perhitungan tarif. Internal berarti tarif Rp 0. Lokal berarti memakai tarif lokal wilayah. Eksternal berarti memakai tarif eksternal region. Golongan I sampai V berasal dari master tarif dan ditentukan otomatis berdasarkan jenis kendaraan, sedangkan kategori dipilih petugas dan menentukan jenis tarif yang dipakai.

Setelah keempat kolom lengkap, tombol Simpan Kendaraan aktif. Ketuk tombol tersebut, lalu muncul panel konfirmasi berisi ringkasan plat, jenis, kategori, dan kondisi kendaraan. Pilih Lanjut Trip untuk menyimpan kendaraan lalu menuju Ringkasan, atau pilih Tambah Lagi untuk menyimpan kendaraan lalu mengosongkan form untuk input kendaraan berikutnya.

Kendaraan yang sudah disimpan tampil di bagian Kendaraan Tersimpan. Setiap kendaraan memiliki tombol Ubah untuk memperbaiki data sebelum trip dikirim dan tombol Hapus untuk mengeluarkan kendaraan dari trip. Selama draft belum kedaluwarsa, petugas masih bisa menambah, mengubah, atau menghapus kendaraan. Setelah draft kedaluwarsa, semua tombol tersebut dinonaktifkan.

(Sisipkan tangkapan layar: form Input Kendaraan dengan empat kolom wajib dan penghitung empat per empat.)

(Sisipkan tangkapan layar: panel konfirmasi Kendaraan Tersimpan dengan tombol Lanjut Trip dan Tambah Lagi.)

4.6 Ringkasan Trip dan Swafoto

Halaman Ringkasan menampilkan ID Trip, status muatan, rute asal ke tujuan beserta kode rute, tanggal dan waktu, daftar kendaraan beserta plat, jenis, kategori, dan kondisi, tombol Tambah kendaraan khusus trip muatan, tombol Ubah pada tiap kendaraan, serta bagian Swafoto Petugas.

Swafoto wajib diambil sebelum trip dapat dikirim. Pada bagian Swafoto Petugas, ketuk Ambil. Kamera depan akan terbuka. Posisikan wajah petugas dan area sekitar sehingga terlihat jelas, lalu ketuk tombol jepret. Setelah tersimpan, foto swafoto tampil di halaman Ringkasan. Jika ingin mengulang, ketuk Ulangi. Swafoto adalah bukti bahwa petugas benar-benar berada di lokasi, sehingga trip tidak bisa dikirim tanpa swafoto.

(Sisipkan tangkapan layar: halaman Ringkasan dengan daftar kendaraan dan bagian Swafoto Petugas.)

4.7 Mengirim Trip

Pastikan semua kendaraan sudah memiliki foto dan swafoto sudah diambil. Periksa kembali rute dan daftar kendaraan. Ketuk Kirim Trip untuk trip bermuatan atau Selesaikan untuk trip kosong. Aplikasi memeriksa ulang lokasi geofence. Jika lokasi tidak valid, pengiriman ditolak dan muncul pesan. Setelah berhasil, aplikasi membuka halaman Trip Tercatat.

Jika ada kendaraan yang belum memiliki foto, muncul pesan peringatan dan tombol kirim tetap nonaktif. Petugas dapat menekan tombol Foto pada kendaraan yang belum lengkap.

4.8 Membatalkan Trip

Ketuk Batalkan Trip. Dialog pembatalan terbuka. Ketik alasan pembatalan yang wajib diisi dengan maksimal 55 huruf, lalu ketuk Batalkan Trip untuk mengonfirmasi.

Pembatalan bukan penghapusan diam-diam. Aplikasi membuat dokumen pembatalan berisi alasan pembatalan, rincian trip berupa rute, kendaraan, jumlah foto, dan waktu, serta foto draft yang sudah diambil jika ada. Dokumen tersebut disimpan di perangkat dan dikirim ke server saat ada koneksi. Admin dapat melihatnya di dashboard pada halaman Pembatalan Trip.

(Sisipkan tangkapan layar: dialog pembatalan trip dengan kolom alasan.)

4.9 Halaman Trip Tercatat dan Status Pengiriman

Setelah trip dikirim, muncul halaman Trip Tercatat. Halaman ini menampilkan status pengiriman yang sebenarnya, bukan hanya tulisan berhasil. Status Terkirim ke Server berwarna hijau berarti data trip sudah diterima server kantor. Status Menunggu Sinkronisasi berwarna kuning berarti data tersimpan di perangkat dan akan dikirim saat koneksi tersedia. Status Gagal Terkirim ke Server berwarna merah berarti server menolak data atau pengiriman gagal permanen, sehingga data belum masuk dashboard admin. Status Tersimpan di Perangkat berwarna abu-abu berarti data tersimpan tetapi belum masuk antrean sinkronisasi.

Jika status belum terkirim, tersedia tombol Coba untuk mengirim ulang. Tombol Lihat Detail membuka detail trip di Riwayat, sedangkan tombol Kembali ke Home kembali ke Beranda.

(Sisipkan tangkapan layar: halaman Trip Tercatat dengan status hijau Terkirim ke Server.)

(Sisipkan tangkapan layar: halaman Trip Tercatat dengan status kuning Menunggu Sinkronisasi.)


5. Riwayat Trip

Halaman Riwayat menampilkan semua trip milik petugas yang sedang login. Bagian atas menampilkan indikator Online atau Offline dan ringkasan jumlah trip terkirim, dibatalkan, gagal kirim, serta lokal atau belum terkirim.

Jika ada draft yang belum selesai, muncul kartu Draft belum terkirim berisi rute atau status draft, sisa waktu draft, status muatan, jumlah kendaraan, jumlah foto, dan waktu terakhir diubah. Tombol Lanjutkan berfungsi melanjutkan pengisian draft. Tombol Kirim Trip muncul jika draft sudah kedaluwarsa dan langsung menuju Ringkasan. Tombol Batalkan membuka dialog pembatalan draft.

Tersedia filter Semua, Muatan, Kosong, dan Dibatalkan. Setiap kartu trip menampilkan rute, ID trip, tanggal dan jam, status muatan, dan status pengiriman berupa Terkirim, Menunggu, Tersimpan di lokal, Gagal, atau Dibatalkan. Ketuk kartu trip untuk membuka Detail Trip.

Halaman Detail Trip menampilkan ID Trip dan rute, status muatan, informasi trip berupa tanggal, jam mulai, durasi, dan petugas, detail kendaraan untuk trip muatan berupa plat, jenis, kategori, dan foto, galeri foto dokumentasi berupa foto bukti trip, foto tiap kendaraan, dan swafoto petugas, serta status pengiriman atau status pembatalan.

Trip yang sudah selesai bersifat final. Tidak ada tombol untuk mengubah plat, jenis, golongan, atau mengambil ulang foto, walaupun data belum sempat terkirim ke server. Jika ada foto yang hilang atau tidak dapat dimuat, aplikasi menampilkan peringatan. Trip yang sudah selesai tidak bisa diedit, sehingga petugas harus menghubungi admin jika foto benar-benar diperlukan. Untuk trip yang dibatalkan, detail menampilkan alasan pembatalan dan status dokumen pembatalan, yaitu sudah diterima server, menunggu koneksi, atau ditolak server.

Riwayat trip yang sudah terkirim lebih dari tujuh hari akan dihapus otomatis dari perangkat untuk menghemat penyimpanan. Data tetap ada di server dan dapat dilihat admin.

(Sisipkan tangkapan layar: halaman Riwayat dengan kartu draft dan daftar trip.)

(Sisipkan tangkapan layar: halaman Detail Trip dengan galeri foto dan status pengiriman.)


6. Profil Petugas dan Ganti Petugas

Halaman Profil menampilkan nama petugas, username, region petugas, label Region Locked, statistik jumlah trip dan kendaraan yang pernah dicatat, serta waktu terakhir aktif. Bagian Koneksi menampilkan apakah perangkat sedang Online atau Offline.

Bagian Pembaruan Aplikasi menampilkan versi APK yang terpasang dan status pembaruan. Ketuk Cek Update untuk memeriksa versi terbaru. Jika ada pembaruan siap pasang, tombol berubah menjadi Update Sekarang. Pembaruan dipasang sebagai APK penuh dan dapat dilakukan langsung dari aplikasi.

Ketuk Lokasi aktif untuk membuka halaman Konfigurasi Geofence. Halaman ini menampilkan daftar titik geofence yang tersimpan di perangkat, nama lokasi, koordinat, radius, rute yang diizinkan, penanda Anda di sini pada titik tempat petugas berada, dan tombol sinkronisasi ulang dari server. Petugas hanya dapat melihat dan menyinkronkan data geofence. Penambahan atau perubahan titik geofence dilakukan admin melalui Master Rute di dashboard.

Jika muncul peringatan Dermaga tidak dikenal, data titik tidak cocok dengan akses dermaga petugas sehingga admin perlu memeriksa Master Rute atau Master Dermaga. Jika muncul peringatan Rute bukan milik dermaga ini, titik geofence mengizinkan rute milik dermaga lain sehingga admin perlu memperbaikinya. Jika muncul pesan belum ada titik geofence, admin perlu mendaftarkan titik untuk rute petugas.

Fitur Ganti Petugas dipakai jika satu perangkat dipakai bergantian oleh beberapa petugas. Buka Profil, ketuk Ganti Petugas, lalu pilih nama rekan kerja yang akan memakai perangkat. Daftar hanya menampilkan petugas dengan region yang sama dan akses dermaga yang bersinggungan. Petugas nonaktif tidak dapat dipilih. Masukkan PIN enam digit petugas yang dipilih, lalu ketuk Konfirmasi PIN.

Jika berhasil, akun aktif berganti ke petugas tersebut. Jika perangkat offline, verifikasi memakai PIN lokal yang tersimpan. Jika PIN belum pernah tersimpan di perangkat, verifikasi offline tidak dapat dilakukan. Untuk keluar dari akun, ketuk Logout Akun di halaman Ganti Petugas.

(Sisipkan tangkapan layar: halaman Profil petugas.)

(Sisipkan tangkapan layar: halaman Ganti Petugas dan layar Verifikasi PIN.)


7. Pembatalan Trip

Pembatalan dilakukan dari halaman Ringkasan melalui tombol Batalkan Trip atau dari kartu draft di Riwayat melalui tombol Batalkan. Ketuk tombol pembatalan, ketik alasan pembatalan pada kolom yang tersedia, lalu ketuk Batalkan Trip untuk mengonfirmasi.

Alasan wajib diisi dengan maksimal 55 huruf. Contoh alasan adalah kendaraan batal dimuat, pelanggan membatalkan, atau salah input plat. Setelah dibatalkan, trip muncul di Riwayat dengan status Dibatalkan, dokumen pembatalan dikirim ke server, dan admin dapat melihat alasan serta rincian pembatalan di dashboard.

Trip yang sudah selesai tidak boleh diubah. Jika ada kesalahan, lakukan pembatalan dengan alasan, lalu buat trip baru. Jangan mencoba mengedit trip lama.


8. Sinkronisasi dan Mode Offline

Saat petugas membuat trip, data disimpan di perangkat dan trip masuk ke antrean pengiriman. Aplikasi mencoba mengirim ke server saat aplikasi dibuka atau kembali aktif, saat perangkat kembali online, saat petugas menekan Paksa Sinkronisasi, dan saat halaman Trip Tercatat dibuka. Jika berhasil, status trip menjadi Terkirim. Jika gagal, aplikasi mencoba ulang dengan jeda yang makin panjang. Setelah beberapa percobaan, trip ditandai Gagal dan petugas dapat mengirim ulang secara manual.

Status antrean terdiri dari Tersimpan di lokal, Menunggu, Terkirim, dan Gagal. Tersimpan di lokal berarti data ada di perangkat tetapi belum masuk antrean kirim. Menunggu berarti data ada di antrean dan menunggu koneksi atau jadwal kirim. Terkirim berarti server sudah menerima data. Gagal berarti server menolak atau pengiriman gagal permanen dan perlu tindakan.

Di Beranda, jika ada trip yang belum terkirim, muncul panel sinkronisasi. Ketuk panel tersebut untuk menjalankan Paksa Sinkronisasi. Pesan akan menunjukkan apakah semua data sudah tersinkron, jumlah trip menunggu, jumlah trip gagal, atau server belum terjangkau. Jangan menutup aplikasi secara paksa saat proses sinkronisasi sedang berjalan. Data tetap aman di perangkat, tetapi pengiriman akan tertunda sampai aplikasi dibuka kembali.


9. Troubleshooting Aplikasi Mobile

Jika petugas tidak bisa login, periksa alamat server, sambungkan perangkat ke intranet, dan periksa PIN. Jika login pertama gagal saat offline, perangkat belum pernah menyimpan data petugas sehingga harus login online terlebih dahulu.

Jika rute tidak muncul, kemungkinan GPS mati, petugas berada di luar geofence, rute belum disinkronkan, atau petugas tidak punya akses dermaga. Aktifkan GPS, kembali ke area, sambungkan ke internet, atau hubungi admin. Jika muncul pesan Area bertugas belum tersedia, admin belum mengatur titik geofence untuk rute tersebut, sehingga admin perlu mengatur Master Rute dan Geofence.

Jika tombol Mulai Trip terkunci, masih ada draft yang belum dikirim atau dibatalkan. Buka Riwayat, lalu lanjutkan atau batalkan draft. Jika draft kedaluwarsa, kirim trip dari Ringkasan atau batalkan dengan alasan.

Jika kamera tidak terbuka, beri izin kamera, tutup aplikasi lain yang sedang memakai kamera, lalu coba lagi. Aplikasi memang hanya mengizinkan foto langsung dari kamera, bukan dari galeri.

Jika trip tidak bisa dikirim, pastikan swafoto sudah ada dan semua kendaraan memiliki foto. Jika trip gagal terkirim, ketuk Coba atau Paksa Sinkronisasi. Jika tetap gagal, catat pesan error dan hubungi admin. Jika status tetap Menunggu, perangkat belum terhubung ke server intranet, sehingga sambungkan ke WiFi kantor lalu paksa sinkronisasi.

Jika data trip tidak muncul di dashboard admin, trip belum terkirim atau gagal terkirim. Periksa status di Riwayat atau Detail Trip, lalu kirim ulang. Jika salah petugas yang login, buka Profil, pilih Ganti Petugas, lalu masukkan PIN petugas yang benar. Jika tidak bisa ganti petugas saat offline, login online terlebih dahulu agar PIN tersimpan. Jika aplikasi meminta update, buka Profil, ketuk Cek Update, lalu Update Sekarang.


BAGIAN 2: DASHBOARD ADMIN

1. Tentang Dashboard Admin

Dashboard admin digunakan untuk memantau trip yang dikirim petugas, melihat laporan, rekap, dan grafik, mengatur master tarif, plat, rute, dermaga, dan petugas, memantau pembatalan trip, mengatur pengaturan aplikasi mobile termasuk batas umur draft, serta melihat statistik server.

Dashboard diakses melalui browser pada alamat yang diberikan admin, umumnya http://alamat-server-kantor:8000. Dashboard membutuhkan koneksi ke API server kantor. Jika API tidak berjalan, dashboard akan menampilkan pesan Tidak bisa terhubung ke server.


2. Login Dashboard Admin

Buka alamat dashboard admin di browser. Jika diminta login, masukkan username dan password admin, lalu ketuk Masuk. Jika login berhasil, dashboard akan terbuka pada halaman Dashboard.

Jika muncul pesan Login admin gagal, periksa username dan password. Jika password baru saja diubah, buka dashboard di tab baru dan gunakan kredensial baru, lalu ketuk Masuk Ulang. Jika muncul pesan Tidak bisa terhubung ke server, pastikan layanan API di server kantor berjalan, periksa koneksi jaringan, lalu ketuk Coba Lagi.

(Sisipkan tangkapan layar: halaman login admin.)


3. Navigasi Dashboard

Menu di sisi kiri dashboard terdiri dari Dashboard, Master Tarif, Master Plat, Master Rute, Master Dermaga, Petugas, dan Pengaturan. Menu Dashboard berfungsi melihat laporan trip, statistik, breakdown, foto, dan akses ke pembatalan trip. Master Tarif berfungsi mengatur tarif per jenis kendaraan dan per region. Master Plat berfungsi mendaftarkan plat kendaraan dan statusnya. Master Rute berfungsi mengatur rute dan titik geofence. Master Dermaga berfungsi mengatur dermaga di setiap wilayah. Petugas berfungsi mengatur akun petugas, PIN, wilayah, dan akses dermaga. Pengaturan berfungsi mengatur tampilan dashboard, batas umur draft, dan endpoint.

Di layar kecil, menu dibuka melalui tombol garis tiga di kiri atas. Halaman Pembatalan Trip tidak tampil langsung di sidebar. Untuk membukanya, buka Dashboard lalu ketuk Buka Pemantauan pada kartu Total Trip. Halaman Statistik Server juga tidak tampil di sidebar dan dibuka melalui alamat http://alamat-server-kantor:8000/server.

(Sisipkan tangkapan layar: sidebar dashboard admin.)


4. Dashboard dan Laporan Trip

Halaman Dashboard adalah halaman utama untuk memantau trip. Bagian atas menampilkan status koneksi, tombol Refresh, tombol Detail Kendaraan, dan ikon untuk membuka Detail Kendaraan di tab baru.

Filter laporan terdiri dari Dari dan Sampai untuk rentang tanggal, pintasan Hari Ini, 7 Hari, dan 30 Hari, serta filter Golongan, Jenis Kendaraan, Dermaga, dan Rute. Filter berlaku untuk kartu statistik, breakdown, dan tabel laporan.

Kartu statistik menampilkan Total Trip beserta jumlah trip berhasil, jumlah trip dibatalkan, dan tombol Buka Pemantauan ke halaman Pembatalan Trip. Kartu Trip Bermuatan menampilkan jumlah dan persentase trip bermuatan. Kartu Trip Tanpa Muatan menampilkan jumlah dan persentase trip kosong. Kartu Pendapatan menampilkan total pendapatan dan rata-rata pendapatan per trip, dengan tombol Show atau Hide Nominal untuk menyembunyikan nominal.

Bagian Breakdown Summary Card menampilkan ringkasan trip, muatan, dan tarif berdasarkan Golongan ke Jenis Kendaraan atau Jenis Kendaraan ke Golongan. Mode dapat diganti melalui tombol di kanan atas kartu. Setiap kolom menampilkan jumlah trip, total pendapatan, persentase per jenis atau golongan, serta rincian Ada Muatan dan Tanpa Muatan untuk data Eksternal. Trip yang tidak memiliki data kendaraan tidak dapat dikelompokkan dan tidak ikut dihitung di breakdown.

Tabel laporan memakai hierarki tanggal, lalu golongan, lalu kendaraan. Header tanggal menampilkan jumlah trip, unit, dan total pendapatan tanggal tersebut. Header golongan menampilkan jumlah trip, unit, ringkasan, dan pendapatan golongan. Baris kendaraan menampilkan satu baris untuk satu kendaraan. Mode tampilan tabel terdiri dari Collapse All untuk hanya menampilkan header tanggal, Expand Header untuk menampilkan header tanggal dan golongan dengan kendaraan tertutup, dan Expand All untuk menampilkan semua kendaraan. Mode bawaan adalah Expand Header.

Kolom tabel terdiri dari No Trip, Jam, Wilayah, Rute, Petugas, No Polisi, Jenis Kendaraan, Muatan, Tarif, dan Foto. Tombol Show atau Hide Nominal menyembunyikan atau menampilkan nominal pendapatan. Tombol Foto dengan jumlah tertentu membuka galeri semua foto pada hasil filter. Klik thumbnail foto untuk membuka pratinjau foto.

Server mengirim maksimal 1000 trip terbaru. Jika jumlah trip mencapai batas tersebut, muncul peringatan agar rentang tanggal dipersempit supaya angka di dasbor dan breakdown akurat.

(Sisipkan tangkapan layar: halaman Dashboard dengan kartu statistik, breakdown, dan tabel laporan.)

(Sisipkan tangkapan layar: tabel laporan dalam mode Expand Header.)


5. Detail Kendaraan atau Laporan Spreadsheet

Halaman Detail Kendaraan menampilkan data yang lebih rinci daripada Dashboard. Setiap baris mewakili satu unit kendaraan, bukan satu trip. Halaman ini dibuka dari tombol Detail Kendaraan pada Dashboard atau melalui alamat dashboard dengan tambahan #/sheet.

Filter pada halaman ini terdiri dari Dari dan Sampai, pintasan Hari Ini, 7 Hari, dan 30 Hari, pencarian berdasarkan nomor trip, plat, petugas, atau rute, filter Golongan, filter Jenis Kendaraan, filter Status Muatan, dan tombol Reset untuk mengosongkan semua filter.

Tabel menampilkan No Trip, Tanggal, Jam, Tempat atau Wilayah, Asal, Tujuan, Petugas, No Polisi, Jenis Kendaraan, Kategori, Status Muatan, Tarif, Foto, dan Lokasi yang dapat diklik menuju Google Maps. Data dikelompokkan per tanggal. Setiap kelompok menampilkan subtotal pendapatan, dan bagian bawah tabel menampilkan total trip, total unit, dan total pendapatan. Halaman ini diperbarui otomatis setiap 15 detik selama tab browser terlihat.

Untuk mengekspor ke Excel, ketuk tombol .xlsx. File akan diunduh dengan nama laporan-trip-tanggal.xlsx dan berisi informasi laporan, header kolom, satu baris per kendaraan, serta baris total. File ini dapat dipakai untuk arsip atau pengolahan di Excel.

(Sisipkan tangkapan layar: halaman Detail Kendaraan beserta filter dan tombol .xlsx.)


6. Rekap Trip

Halaman Rekap menampilkan ringkasan jumlah kendaraan dan pendapatan per golongan dan jenis kendaraan. Halaman ini dibuka dari tombol Rekap pada halaman Detail Kendaraan atau melalui alamat dashboard dengan tambahan #/sheet/rekap.

Filter pada halaman Rekap terdiri dari Dari dan Sampai, pintasan Hari Ini, 7 Hari, dan 30 Hari, filter Rute, filter Golongan, dan tombol Reset. Tabel menampilkan Golongan, Jenis Kendaraan, Tanpa Muatan, Dengan Muatan, Total Kendaraan, dan Total Pendapatan. Setiap golongan memiliki baris Total golongan, dan bagian bawah menampilkan Total All Golongan.

Ketuk tombol .xlsx untuk mengunduh rekap dalam format Excel. Sama seperti laporan lain, server mengirim maksimal 1000 trip terbaru. Jika muncul peringatan batas data, persempit rentang tanggal agar total akurat.

(Sisipkan tangkapan layar: halaman Rekap Trip.)


7. Pembatalan Trip

Halaman ini menampilkan dokumen pembatalan yang dikirim petugas dari aplikasi mobile. Untuk membukanya, buka Dashboard lalu ketuk Buka Pemantauan pada kartu Total Trip.

Filter Rentang berfungsi memilih rentang waktu pembatalan. Tombol Muat ulang memuat ulang data dari server. Tombol Ekspor .xlsx mengunduh data pembatalan ke Excel. Tombol Tutup kembali ke Dashboard. Tombol Collapse All, Expand Header, dan Expand All mengatur tampilan daftar.

Kartu ringkasan menampilkan Total Pembatalan berupa jumlah trip yang dibatalkan, Golongan dan Jenis Kendaraan berupa jumlah unit kendaraan yang terlibat, Alasan Teratas berupa alasan pembatalan yang paling sering muncul, dan Petugas berupa jumlah dan nama petugas yang melakukan pembatalan.

Daftar rincian dikelompokkan berdasarkan petugas, lalu tanggal. Satu baris mewakili satu kendaraan. Kolom yang ditampilkan adalah No Trip atau Info Group, Waktu Batal, Golongan, Jenis Kendaraan, No Polisi, Petugas Autorisasi, dan Foto. Klik baris untuk melihat detail pembatalan, termasuk alasan yang diketik petugas dan rincian kendaraan. Alasan pembatalan diketik langsung oleh petugas di aplikasi mobile. Jika alasan kurang jelas, admin dapat menindaklanjuti ke petugas yang bersangkutan.

(Sisipkan tangkapan layar: halaman Pembatalan Trip dengan kartu ringkasan dan daftar pembatalan.)


8. Master Tarif

Halaman Master Tarif digunakan untuk mengatur harga per jenis kendaraan dan per region. Bagian halaman terdiri dari status server, filter Region, Master Jenis Kendaraan, kartu jenis kendaraan, tabel tarif per region, dan panel Tambah atau Edit Tarif.

Kolom tarif terdiri dari Jenis Kendaraan, Internal, Lokal, Ada Muatan, Kosong, dan Aksi. Internal selalu Rp 0 dan terkunci karena kendaraan internal tidak ditagih. Lokal adalah tarif untuk kendaraan lokal di region tersebut. Jika diisi 0, sistem memakai tarif lokal wilayah. Ada Muatan adalah tarif eksternal untuk kendaraan bermuatan. Kosong adalah tarif eksternal untuk kendaraan tanpa muatan. Tanda titik biru di samping nama jenis kendaraan berarti baris tarif region tersebut sudah tersimpan.

Untuk mengubah tarif langsung di tabel, cari region dan jenis kendaraan yang ingin diubah, klik angka pada sel Lokal, Ada Muatan, atau Kosong, ketik nominal baru, lalu tekan Enter atau klik di luar sel untuk menyimpan. Perubahan langsung disimpan ke server.

Untuk menambah atau mengedit tarif melalui panel, pilih Region. Pilih region tertentu atau pilih Semua Region untuk menerapkan tarif ke banyak region sekaligus. Pilih Jenis Kendaraan, lalu isi nominal Internal yang terkunci Rp 0, Lokal yang hanya tersedia untuk region tertentu, Eksternal Ada Muatan, dan Eksternal Kosong. Ketuk Simpan.

Jika memilih Semua Region, tarif untuk jenis kendaraan tersebut berlaku di semua region sekaligus. Saat mengedit, hanya region yang sudah memakai jenis tersebut yang diperbarui. Tarif Lokal tidak bisa disamakan untuk semua region karena bersifat per wilayah.

Untuk menambah jenis kendaraan baru, ketik nama jenis pada panel Master Jenis Kendaraan, lalu ketuk Tambah. Jenis baru langsung tersimpan di database dan muncul di aplikasi petugas. Untuk menghapus jenis, ketuk ikon tempat sampah di samping nama jenis. Master jenis kendaraan adalah sumber tunggal, sehingga semua pilihan jenis kendaraan di HP petugas berasal dari daftar ini.

Untuk menghapus baris tarif, ketuk ikon tempat sampah pada kolom Aksi. Baris tarif untuk jenis kendaraan tersebut di region itu akan dihapus.

Perubahan tarif hanya berlaku untuk trip berikutnya. Trip yang sudah terkirim memakai harga yang tercatat saat trip dikirim. Laporan tidak menghitung ulang tarif lama dari master yang berlaku sekarang. Jika ingin mengoreksi harga trip lama, lakukan pembatalan dan buat trip baru.

(Sisipkan tangkapan layar: halaman Master Tarif dengan tabel per region dan panel Tambah atau Edit Tarif.)


9. Master Plat

Halaman Master Plat digunakan untuk mendaftarkan nomor plat kendaraan dan statusnya. Form daftar plat terdiri dari No Plat yang wajib, Pemilik yang opsional, Region Asal, dan Status.

Status plat internal berarti kendaraan internal perusahaan dengan tarif Rp 0 atau tidak ditagih. Status lokal berarti kendaraan lokal wilayah dengan tarif lokal region. Status eksternal berarti kendaraan dari luar wilayah dengan tarif eksternal region.

Untuk menambah plat, isi No Plat, isi pemilik jika perlu, pilih Region Asal, pilih Status, lalu ketuk tombol simpan. Untuk mengubah atau menghapus plat, ketuk Edit atau Hapus pada baris plat. Plat internal tidak dikenakan tarif saat diinput di aplikasi petugas, sehingga pastikan status plat benar agar tarif trip sesuai.

(Sisipkan tangkapan layar: halaman Master Plat dengan form dan tabel plat.)


10. Master Rute dan Geofence

Halaman Master Rute digunakan untuk mengatur rute per wilayah atau dermaga dan titik geofence. Untuk menambah rute baru, pada form Tambah Rute Baru pilih Dermaga, isi Nama Rute seperti Sijangkung ke Sabadi, isi Asal dengan kode lokasi seperti SJRE, isi Tujuan dengan kode lokasi seperti SBDZ, lalu ketuk Tambah Rute. Rute baru langsung tersimpan ke database dan dipakai aplikasi petugas setelah sinkronisasi.

Tabel rute dikelompokkan berdasarkan Region, lalu Dermaga. Setiap baris memiliki tombol Edit untuk mengubah nama atau kode rute, tombol Geofence untuk membuka pengaturan titik geofence, dan tombol Hapus untuk menghapus rute.

Geofence menentukan di mana petugas boleh memulai atau menyelesaikan trip dan rute mana yang muncul serta boleh dipilih petugas. Pada baris rute, ketuk Geofence. Panel Titik Geofence terbuka. Ketuk Tambah Titik Geofence, lalu isi Nama Lokasi seperti Dermaga Badau Titik A, pilih Dermaga, isi Latitude dan Longitude secara manual atau tempel link Google Maps lalu ketuk Isi Otomatis, isi Radius dalam meter dengan bawaan 100 meter, isi Keterangan jika perlu, dan isi Rute yang diizinkan berupa daftar kode rute yang boleh dipakai di titik tersebut. Periksa pratinjau peta, lalu ketuk Simpan.

Titik geofence yang sudah ada dapat diedit, dihapus, dan dilihat pratinjau petanya. Jika titik geofence tidak diatur, petugas akan melihat pesan Area bertugas belum tersedia dan tidak bisa memilih rute. Pastikan setiap rute yang dipakai petugas memiliki titik geofence dengan daftar rute yang benar. Radius yang terlalu kecil dapat membuat petugas sulit memulai trip karena GPS bergeser beberapa meter, sehingga gunakan radius yang sesuai dengan kondisi lokasi.

(Sisipkan tangkapan layar: halaman Master Rute dengan tabel rute dan tombol Geofence.)

(Sisipkan tangkapan layar: panel Titik Geofence dengan form koordinat, radius, dan daftar rute.)


11. Master Dermaga

Halaman Master Dermaga digunakan untuk mengatur dermaga di setiap wilayah. Untuk menambah dermaga, pilih Wilayah, isi Nama Dermaga seperti Dermaga Badau, isi Kode Dermaga seperti BDU dengan panjang 2 sampai 16 karakter, tanpa spasi, dan unik di dalam satu wilayah, lalu ketuk Tambah Dermaga.

Daftar dermaga dikelompokkan per wilayah dan menampilkan nama dermaga, kode, jumlah rute, dan jumlah petugas di wilayah tersebut. Gunakan kolom pencarian untuk mencari nama atau kode dermaga. Setiap baris memiliki tombol Ubah nama dan Hapus.

Region atau wilayah tidak bisa ditambahkan dari dashboard karena sudah ditetapkan sistem. Dermaga baru ditambahkan di bawah wilayah yang sudah ada. Dermaga yang masih dipakai rute atau petugas sebaiknya tidak dihapus sebelum data terkait dipindahkan. Jika muncul kelompok Dermaga tanpa wilayah, berarti wilayah dermaga tersebut sudah tidak ada di database dan admin teknis perlu memeriksanya.

(Sisipkan tangkapan layar: halaman Master Dermaga dengan form tambah dan daftar per wilayah.)


12. Master Petugas

Halaman Petugas digunakan untuk mengatur akun petugas lapangan. Untuk menambah petugas, ketuk Tambah Petugas, isi Nama, pilih Wilayah, centang Dermaga yang boleh diakses, isi PIN yang disarankan enam digit, lalu ketuk Simpan.

Untuk mengedit petugas, buka menu aksi pada baris petugas dan pilih Edit. Ubah data yang diperlukan, seperti Nama, Wilayah yang dapat dipilih lebih dari satu, Dermaga yang pilihannya mengikuti wilayah yang dicentang, dan PIN Baru yang hanya diisi jika ingin mengganti PIN. Setelah itu ketuk Update.

Setiap petugas memiliki status Aktif atau Nonaktif. Status Aktif berarti petugas dapat login dan memakai aplikasi. Status Nonaktif berarti petugas tidak dapat login ke aplikasi mobile. Gunakan menu aksi untuk mengubah status. Untuk menghapus petugas, gunakan menu aksi Hapus. Petugas yang dihapus tidak dapat login lagi.

Petugas dapat memiliki akses ke lebih dari satu wilayah dan lebih dari satu dermaga, termasuk dermaga di wilayah berbeda. Saat petugas memiliki akses lebih dari satu dermaga, aplikasi mobile akan meminta petugas memilih dermaga pada awal trip. Daftar petugas dikelompokkan per wilayah dan menampilkan nama, username, kode dermaga yang diakses, rute yang tersedia, status, dan menu aksi.

Petugas harus memiliki minimal satu akses dermaga agar bisa memulai trip. Jika petugas belum memiliki akses dermaga, aplikasi mobile akan menampilkan pesan Hubungi Admin.

(Sisipkan tangkapan layar: halaman Master Petugas dengan form tambah dan daftar petugas.)

(Sisipkan tangkapan layar: form edit petugas dengan pilihan beberapa wilayah dan dermaga.)


13. Pengaturan Dashboard

Halaman Pengaturan memiliki tiga bagian, yaitu Tampilan, Batas Umur Draft Trip, dan Endpoint.

Bagian Tampilan mengatur mode warna Terang atau Gelap, ukuran tampilan, warna aksen dashboard, dan tombol Reset untuk mengembalikan tampilan ke bawaan. Pengaturan tampilan disimpan di perangkat dan hanya berlaku untuk dashboard admin, bukan aplikasi mobile petugas.

Bagian Batas Umur Draft Trip mengatur berapa lama draft trip boleh diisi di aplikasi mobile. Isi Batas dalam menit dengan nilai yang diizinkan 1 sampai 240 menit, lalu ketuk Simpan Pengaturan. Setelah disimpan, nilai berlaku di perangkat petugas saat aplikasi dibuka. Perangkat yang offline memakai nilai terakhir yang berhasil ditarik. Draft yang melewati batas akan dikunci dan petugas hanya bisa mengirim atau membatalkan.

Bagian Endpoint mengatur alamat server yang dipakai dashboard. Pilih endpoint yang tersedia atau isi URL manual, ketuk Simpan dan Terapkan, dan gunakan Tes Koneksi untuk memastikan server merespons.

(Sisipkan tangkapan layar: halaman Pengaturan dengan panel Tampilan, Batas Umur Draft, dan Endpoint.)


14. Statistik Server

Halaman Statistik Server menampilkan kondisi server kantor berupa status koneksi, request rate, latency, penggunaan CPU, penggunaan RAM, penggunaan disk, dan load server. Halaman ini dibuka melalui alamat http://alamat-server-kantor:8000/server. Gunakan halaman ini untuk memeriksa apakah server kantor sehat atau sedang kelebihan beban.

(Sisipkan tangkapan layar: halaman Statistik Server.)


15. Troubleshooting Dashboard Admin

Jika muncul pesan Tidak bisa terhubung ke server, API server kantor tidak berjalan atau jaringan terputus. Pastikan layanan API aktif, periksa jaringan, lalu ketuk Coba Lagi. Jika muncul pesan Login admin gagal, username atau password salah atau kredensial berubah. Masukkan ulang kredensial, dan buka tab baru jika password baru diubah.

Jika dashboard kosong atau laporan tidak muncul, filter tanggal mungkin terlalu sempit, data belum tersinkron, atau server offline. Perluas rentang tanggal, tekan Refresh, dan periksa status server. Jika angka laporan tidak sama dengan ekspektasi, periksa batas 1000 trip terbaru dan filter yang aktif. Persempit rentang tanggal serta periksa filter golongan, jenis, dermaga, dan rute.

Jika perubahan tarif tidak mengubah trip lama, itu adalah perilaku yang benar karena trip lama memakai harga snapshot saat dikirim. Buat trip baru untuk harga baru. Jika petugas tidak bisa login, periksa status nonaktif, PIN, dan akses dermaga. Aktifkan petugas, reset PIN, dan beri akses dermaga jika perlu.

Jika rute tidak muncul di aplikasi petugas, rute belum dibuat, geofence belum diatur, atau data belum tersinkron. Periksa Master Rute dan titik geofence, lalu minta petugas melakukan sinkronisasi. Jika petugas selalu dianggap di luar area, koordinat atau radius geofence tidak sesuai atau GPS petugas meleset. Periksa titik geofence dan radius, lalu minta petugas menyalakan GPS.

Jika dermaga tidak bisa ditambahkan, wilayah belum dipilih atau kode dermaga tidak valid atau duplikat. Pilih wilayah dan gunakan kode 2 sampai 16 karakter tanpa spasi yang unik. Jika ekspor Excel gagal, tidak ada data pada filter atau unduhan diblokir browser. Perluas filter dan izinkan unduhan di browser. Jika pembatalan tidak muncul, dokumen belum terkirim dari perangkat atau filter rentang tidak cocok. Minta petugas menyambungkan perangkat dan periksa rentang di halaman Pembatalan Trip.


LAMPIRAN

A. Ketentuan Tarif

Tarif trip ditentukan dengan urutan berikut. Pertama, kendaraan internal selalu Rp 0. Kedua, jika region memiliki baris tarif sendiri atau override, nilai tersebut dipakai. Ketiga, jika region tidak memiliki override, tarif master dipakai. Keempat, tarif lokal wilayah dipakai untuk kendaraan lokal jika tarif lokal belum diisi. Kelima, jika tidak ada tarif yang cocok, tarif menjadi Rp 0.

Setiap region dapat memiliki harga berbeda untuk jenis kendaraan yang sama. Region yang belum memiliki baris tarif akan mewarisi tarif master, sehingga tidak perlu menyalin semua baris. Tarif disimpan sebagai snapshot saat trip dikirim, sehingga perubahan tarif setelahnya tidak mengubah trip lama. Kendaraan internal tidak ditagih. Kategori kendaraan Internal, Lokal, atau Eksternal menentukan jenis tarif yang dipakai, sedangkan golongan I sampai V berasal dari master tarif dan ditentukan berdasarkan jenis kendaraan.


B. Status dan Istilah

Status trip di aplikasi mobile terdiri dari Tersimpan di lokal, Menunggu, Terkirim, Gagal, dan Dibatalkan. Tersimpan di lokal berarti data ada di perangkat tetapi belum masuk antrean kirim. Menunggu berarti data ada di antrean dan menunggu koneksi. Terkirim berarti server sudah menerima data. Gagal berarti server menolak atau pengiriman gagal permanen. Dibatalkan berarti trip dibatalkan petugas dan memiliki dokumen pembatalan.

Status plat terdiri dari internal, lokal, dan eksternal. Internal berarti kendaraan internal dengan tarif Rp 0. Lokal berarti kendaraan lokal dengan tarif lokal region. Eksternal berarti kendaraan luar wilayah dengan tarif eksternal region.

Kategori kendaraan terdiri dari Internal, Lokal, dan Eksternal. Internal berarti kendaraan perusahaan yang tidak ditagih. Lokal berarti kendaraan lokal wilayah. Eksternal berarti kendaraan dari luar wilayah.


C. Checklist Operasional Harian

Untuk petugas, pastikan HP terhubung ke WiFi intranet kantor, buka aplikasi dan pastikan alamat server benar, login dengan ID Petugas dan PIN, pastikan GPS dan kamera aktif, mulai trip, pilih status muatan, dan pilih rute sesuai lokasi, input kendaraan lengkap dengan foto, ambil swafoto petugas, kirim trip dan periksa status pengiriman. Jika status belum terkirim, sambungkan ke internet dan lakukan Paksa Sinkronisasi. Periksa Riwayat untuk memastikan tidak ada trip yang gagal terkirim.

Untuk admin, buka dashboard dan pastikan status server Tersambung, periksa laporan trip hari ini, periksa apakah ada trip yang gagal terkirim atau belum masuk, periksa pembatalan trip dan alasannya, periksa master tarif jika ada perubahan harga, periksa master plat untuk kendaraan internal baru, periksa rute dan geofence jika ada petugas yang melaporkan rute tidak muncul, periksa data petugas dan akses dermaga untuk petugas baru, serta unduh laporan Excel jika diperlukan untuk arsip atau keuangan.


D. Daftar Tangkapan Layar yang Disarankan

Untuk aplikasi mobile, siapkan tangkapan layar halaman login, ikon gerigi dan panel Pengaturan Server, halaman Beranda, halaman Pilih Dermaga, halaman Status Muatan, halaman Pilih Rute saat di dalam area, halaman Pilih Rute saat di luar area, form Input Kendaraan dengan empat kolom lengkap, panel konfirmasi Kendaraan Tersimpan, halaman Ringkasan dengan Swafoto Petugas, dialog pembatalan trip, halaman Trip Tercatat dengan status terkirim, halaman Trip Tercatat dengan status menunggu, halaman Riwayat dengan kartu draft, halaman Detail Trip, halaman Profil, halaman Ganti Petugas, layar Verifikasi PIN, dan halaman Konfigurasi Geofence.

Untuk dashboard admin, siapkan tangkapan layar halaman login admin, sidebar dashboard, Dashboard dengan kartu statistik dan tabel laporan, tabel laporan mode Expand Header, halaman Detail Kendaraan, halaman Rekap Trip, halaman Pembatalan Trip, halaman Master Tarif, panel Tambah atau Edit Tarif, halaman Master Plat, halaman Master Rute, panel Titik Geofence, halaman Master Dermaga, halaman Master Petugas, form edit petugas dengan multi-wilayah dan multi-dermaga, halaman Pengaturan, dan halaman Statistik Server.


Dokumen ini disusun berdasarkan implementasi aplikasi Trip Angkutan. Jika ada perubahan fitur, perbarui bagian yang terkait agar panduan tetap sesuai dengan aplikasi yang dipakai petugas dan admin.
