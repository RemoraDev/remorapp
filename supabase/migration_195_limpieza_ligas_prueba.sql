update public.tournaments set liga_id = null
  where liga_id in (
    select id from public.ligas where nombre in ('12', 'tuculo')
  );

delete from public.ligas where nombre in ('12', 'tuculo');
