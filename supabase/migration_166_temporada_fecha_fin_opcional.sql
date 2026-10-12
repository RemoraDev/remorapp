-- Migración 166: fecha_fin de una temporada deja de ser obligatoria
-- al crearla -- a pedido del usuario, se puede completar después
-- desde la ficha del torneo (Panel de organizador → Temporadas). No
-- hay ninguna función que dependa de fecha_fin para expirar nada
-- automáticamente (es solo informativa en la UI), así que sacar el
-- not null no rompe lógica existente. El check (fecha_fin > fecha_inicio)
-- ya admite null sin violarse (una comparación con null da null, no
-- false, en Postgres).
alter table public.temporadas alter column fecha_fin drop not null;
