-- Migración 160: recorta la paleta de Apariencia del equipo de 7 a 5
-- colores (Celeste/Verde claro/Violeta/Rosa/Cyan) y cambia el acento
-- por defecto de toda la app de cian a celeste -- a pedido del
-- usuario. "cian" pasa a llamarse "cyan" (mismo color, clave nueva);
-- "purpura"->"violeta" y "esmeralda"->"verde_claro" son renombres;
-- "ambar"/"carmesi"/"azul" se sacan del catálogo -- los equipos que
-- los tenían elegidos quedan en "celeste", el nuevo default.
update public.teams set tema_equipo = 'cyan' where tema_equipo = 'cian';
update public.teams set tema_equipo = 'violeta' where tema_equipo = 'purpura';
update public.teams set tema_equipo = 'verde_claro' where tema_equipo = 'esmeralda';
update public.teams set tema_equipo = 'celeste' where tema_equipo in ('ambar', 'carmesi', 'azul');

alter table public.teams drop constraint if exists teams_tema_equipo_check;
alter table public.teams
  add constraint teams_tema_equipo_check
  check (tema_equipo in ('celeste', 'verde_claro', 'violeta', 'rosa', 'cyan'));

alter table public.teams alter column tema_equipo set default 'celeste';
