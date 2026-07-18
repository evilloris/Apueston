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


## Minijuego Adivina el número (v27)

Para una base de datos que ya está instalada, ejecuta una sola vez `ACTUALIZAR_MINIJUEGO_ADIVINA_NUMERO.sql` en Supabase SQL Editor antes de publicar esta versión. No ejecutes nuevamente `supabase_schema.sql`, porque es el instalador desde cero.

El minijuego usa funciones SQL atómicas para descontar créditos, generar el resultado, continuar, cobrar y evitar solicitudes duplicadas. Las partidas activas se recuperan al recargar la página. El código administrativo configurado en la migración coincide con `CONFIG.ADMIN_CODE` (`pktrn1907`); cambia ambos si modificas el código del organizador.


## v28
- La activación del minijuego se guarda inmediatamente al cambiar la casilla.
- Se eliminó la probabilidad aproximada de la interfaz para todos los usuarios.

## v30 · Campo Minado

Se agregó Campo Minado dentro de Minijuegos y su configuración dentro de la subpestaña Configuración para administradores.

Antes de usarlo, ejecuta una sola vez en Supabase SQL Editor el archivo:

`ACTUALIZAR_MINIJUEGO_CAMPO_MINADO.sql`

La migración no elimina cuentas, torneos, apuestas ni datos existentes.

Nota lógica: el nivel 7 conserva las 35 minas solicitadas. Como en un tablero de 36 casillas solo queda una casilla segura, ese nivel se completa al descubrir esa única casilla y aplica x2.00 automáticamente.

## Actualización v33: justificante de recarga propia del administrador
Ejecuta una sola vez `ACTUALIZAR_JUSTIFICANTE_RECARGA_ADMIN.sql` en Supabase. Cuando el administrador recargue su propia cuenta, deberá escribir un justificante obligatorio, que quedará visible en el historial de caja.

## Actualización v36: solicitudes de dinámicas de cajeros
Ejecuta una sola vez `ACTUALIZAR_SOLICITUDES_DINAMICAS_CAJEROS.sql`. Los cajeros solo seleccionan la cuenta y describen la dinámica. El administrador decide cuántos créditos entregar y aprueba o rechaza. Las adiciones y retiros directos del administrador en esta pestaña no se registran en el historial de caja.

## Actualización v37
Ejecuta una sola vez `ACTUALIZAR_SOLICITUDES_DINAMICAS_CAJEROS_V2.sql` en Supabase.
Los cajeros ahora indican cuenta, cantidad y descripción; el administrador únicamente aprueba o rechaza la cantidad solicitada. El administrador puede hacer adiciones directas indicando cuenta, cantidad y descripción.

## v39
- El mercado de hándicap muestra cuatro botones: hándicap positivo y negativo para cada participante.
- La magnitud del hándicap se calcula según las estadísticas de ambos participantes.
- Cada una de las cuatro selecciones tiene su propia cuota.
- No se modificó la lógica de «Quién gana» ni de «Marcador exacto».

## v40 · Comunicados y encuestas

Antes de usar esta versión, ejecuta una sola vez en Supabase:

`ACTUALIZAR_COMUNICADOS_Y_ENCUESTAS.sql`

En Inicio, el administrador puede crear comunicados con respuestas opcionales y encuestas con cualquier cantidad de opciones. Los usuarios pueden responder y votar con su cuenta.
