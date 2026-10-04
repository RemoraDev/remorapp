-- Migración 156: franja lateral de escritorio personalizable -- a
-- pedido del usuario, la columna izquierda decorativa de la versión
-- de escritorio (panal de hexágonos, EscritorioColumnaLateral.tsx)
-- pasa a poder reemplazarse por una imagen propia, "como un papel
-- tapiz lateral". Sin imagen subida, se sigue viendo el panal de
-- hexágonos de siempre (fallback en el frontend, no acá). Tanto
-- profiles como teams suman su propia columna -- un jugador puede
-- subir la suya propia o copiar la de su clan (si pertenece a uno y
-- ese clan ya subió la suya), mismo mecanismo de copia puntual que
-- foto_presentacion_url (migración 154).
alter table public.profiles add column escritorio_lateral_url text;
alter table public.teams add column escritorio_lateral_url text;
