-- ------------------------------------------------------------
-- Migración 056: borde del header -- sistema aparte, mucho más simple
-- que los "Bordes de Avatar" de Mi perfil (migraciones 052/054/055):
-- sin grosor editable, sin efectos, solo 4 colores lisos fijos. Se
-- aplica exclusivamente al avatar del header, nunca a la vitrina
-- pública -- son dos sistemas independientes.
-- ------------------------------------------------------------

alter table public.profiles
  add column borde_header text not null default 'negro'
    check (borde_header in ('negro', 'cyan', 'amarillo', 'verde'));

-- Autoservicio directo, mismo patrón que avatar_forma/borde_basico_activo:
-- sin RPC, el check constraint ya valida los 4 valores posibles.
grant select (borde_header) on public.profiles to anon, authenticated;
grant update (borde_header) on public.profiles to authenticated;
