# Liga Pokémon · Poképachanga

Proyecto limpio para GitHub Pages + Supabase.

## Archivos

- `index.html`: interfaz.
- `styles.css`: diseño.
- `app.js`: lógica.
- `config.js`: conexión de Supabase y código de organizador.
- `supabase_schema.sql`: crea toda la base desde cero.
- `reset_data.sql`: borra todos los datos sin borrar tablas.

## Instalación

1. En Supabase abre **SQL Editor**.
2. Ejecuta todo `supabase_schema.sql`.
3. Sube `index.html`, `styles.css`, `app.js` y `config.js` a la raíz del repositorio de GitHub.
4. Activa GitHub Pages desde la rama `main`, carpeta `/ (root)`.
5. Abre la URL de GitHub Pages y recarga con `Ctrl + F5`.

## Reiniciar datos

Ejecuta `reset_data.sql` en Supabase.

## Seguridad

Esta versión está pensada para una liga privada entre amigos. Usa una publishable key y políticas públicas para funcionar directamente desde GitHub Pages, sin servidor propio. No la uses para apuestas con dinero real ni contraseñas reutilizadas.

## Versión 5
- Finalización de peleas y creación de fases con actualización optimista inmediata.
- Eliminatorias formadas únicamente por los primeros N de cada grupo.
- ELO visible solo para el organizador.
- ELO individual según rival, resultado y KO; en 2v2 usa el promedio rival y da prioridad natural al jugador de menor ELO.
- Las dobles entregan menos ELO y los partidos de torneo aplican multiplicador x2.

## Cambios v6
- Nueva pestaña administrativa **Eventos**, con subpestañas **Torneos** y **Peleas individuales**.
- Peleas individuales 1v1, 2v2 y 1v1 doble, integradas con apuestas, marcador en vivo, cuotas y ELO.
- Botón para reiniciar todas las estadísticas y botón individual por jugador.
- El reinicio devuelve ELO a 1000 y pone PG, PP, KO+ y KO- en cero.
