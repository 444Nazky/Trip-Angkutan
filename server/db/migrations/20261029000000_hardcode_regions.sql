-- Wilayah tetap (hardcoded): Badau, Empanang, Kenepai (KMP1), Sejiram, Sintang (KMP2).
-- Wilayah di luar daftar dihapus permanen beserta dermaganya.
-- Dampak: rute & akses petugas dermaga ikut terhapus (CASCADE), petugas kehilangan
-- relasi wilayah (SET NULL / CASCADE), riwayat trip tetap ada tanpa relasi wilayah.

begin;

delete from dermagas
where region_id in (
  select id from regions
  where name not in ('Badau', 'Empanang', 'Kenepai', 'Sejiram', 'Sintang')
);

delete from regions
where name not in ('Badau', 'Empanang', 'Kenepai', 'Sejiram', 'Sintang');

update regions set code = 'KMP1' where name = 'Badau';

insert into regions (name, code)
select v.name, v.code
from (values
  ('Empanang', 'KMP1'),
  ('Kenepai', 'KMP1'),
  ('Sejiram', 'KMP2'),
  ('Sintang', 'KMP2')
) as v(name, code)
where not exists (select 1 from regions r where lower(r.name) = lower(v.name));

commit;
