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

## Versión 16
- La ruleta diaria muestra dentro del círculo los nombres de sus 7 premios semanales y una lista legible debajo.
- Se añadió un constructor de apuestas combinadas con ganador, hándicap y marcador exacto.
- Las selecciones conservan la cuota del momento en que se agregan; la cuota final se multiplica y queda bloqueada al confirmar.
- Las combinadas se resuelven automáticamente cuando terminan sus selecciones.

## Rol de cajero
Antes de subir esta versión, ejecuta una sola vez `ACTUALIZAR_CAJEROS_SUPABASE.sql` en Supabase SQL Editor. No vuelvas a ejecutar `supabase_schema.sql` sobre una base con datos.

El administrador asigna o quita el rol desde **Cuentas**. El cajero ve la pestaña **Caja**, no puede modificar su propio saldo y sus retiros se cubren con el fondo común generado por el 70% de las recargas. La comisión acumulada del cajero es el 30% de los diamantes equivalentes, usando 1 diamante = 30 créditos.
