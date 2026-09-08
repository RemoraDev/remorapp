-- ------------------------------------------------------------
-- Migración 075: se elimina Delfin Mode por completo (decisión del
-- dueño de la plataforma) -- el chat de texto por equipo (migración
-- 071) y su refuerzo de lenguaje inapropiado a nivel de base
-- (migración 072). "Noticias" ocupa su lugar en la barra inferior.
--
-- La integración de voz con LiveKit nunca llegó a conectarse con
-- credenciales reales -- del lado de la base nunca tocó nada más que
-- esto (mensajes_equipo/RLS), así que no hay nada de LiveKit que
-- eliminar acá; el resto (función Edge, dependencia del SDK,
-- variables de entorno) se retiró del lado del código.
--
-- Se deja la extensión unaccent instalada (inerte, no molesta a nada)
-- en vez de desinstalarla -- no vale la pena el riesgo de tocar una
-- extensión por una tabla que se está yendo.
-- ------------------------------------------------------------

drop table if exists public.mensajes_equipo cascade;
drop function if exists public.contiene_lenguaje_inapropiado(text);
