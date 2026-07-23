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


## v41 · Edición de comunicados y respuestas

El administrador puede editar comunicados. Cada usuario puede editar una sola vez cada respuesta propia.
Si ya ejecutaste la migración de v40, ejecuta `ACTUALIZAR_EDICION_COMUNICADOS_Y_RESPUESTAS.sql` una sola vez.


## v45 · 1025 Pokémon y ruleta por generaciones
- Se cargaron los 1025 Pokémon con su código Pokédex y clasificación.
- La ruleta completa conserva su lógica y precios anteriores.
- Por generación: 500 créditos por giro o 4500 por 10.


## v46 · Formas regionales automáticas

Los Pokémon indicados pueden obtener forma normal, de Alola, de Galar o de Hisui mediante una segunda selección automática. La forma aparece junto a la clasificación y queda guardada en la recompensa.


## v47 · Buscador de Pokémon

Se agregó debajo de la Ruleta Pokémon un buscador por nombre o código Pokédex que muestra la generación correspondiente. No requiere SQL nuevo.


## v49 · Gestión múltiple de recompensas

- Se eliminó la confirmación emergente al descartar.
- Cada recompensa disponible tiene una casilla de selección.
- Las recompensas seleccionadas pueden reclamarse o descartarse en grupo.
- “Mis recompensas” ahora tiene las pestañas “Recompensas” y “Pendientes”.
- “Recompensas” muestra solo las disponibles; “Pendientes” muestra las ya reclamadas y aún no entregadas.
- No requiere SQL nuevo.


## v50 · Ajuste de probabilidades y selección de recompensas

- En la ruleta por generación, cada Pokémon no común tiene una probabilidad individual 5 veces menor que un Pokémon común de esa misma generación.
- Se corrigió la carga del código nuevo de recompensas mediante actualización de versión de caché (`app.js?v=50` y `styles.css?v=50`).
- Las casillas aparecen a la derecha de cada recompensa disponible.
- “Seleccionar todas” selecciona correctamente las recompensas visibles y actualiza el contador.
- No requiere cambios SQL.


## Cambios v51
- El botón Inicio muestra un contador rojo de comunicados y encuestas nuevos. Se marca como leído al abrir Inicio y se guarda por cuenta en el navegador.
- En Entrega de recompensas, el administrador tiene un botón C para copiar `/pokegiveother usuario pokemon lvl=20`.
- Se agregaron las equivalencias entre usuarios de la página y nombres de Minecraft indicadas por el organizador.
- No requiere ejecutar SQL nuevo.

## v52 — comando agrupado de entrega
- Se eliminó el botón de copiado individual de cada recompensa.
- Al filtrar una cuenta específica en **Entrega de recompensas**, aparece un único botón para copiar todos sus Pokémon pendientes.
- Formato: `/reward jugador Pokemon 20,Pokemon 20,...`.
- Se conservan las equivalencias entre el usuario de la página y su nombre de Minecraft.


## v53 — nivel general y formas regionales en `/reward`
- En **Entrega de recompensas** se agregó un nivel general editable entre 1 y 100.
- El nivel elegido se usa para todos los Pokémon del comando y queda recordado en el navegador.
- Las formas regionales agregan la región después del nivel: `Goodra 35 hisui`, `Vulpix 35 alola` o `Articuno 35 galar`.
- Los Pokémon normales mantienen el formato `Pokemon nivel`.
- No requiere ejecutar SQL nuevo.


## v54 · Entrega por lotes de 15
- Las formas regionales usan el formato `Pokemon region nivel`, por ejemplo `Goodra hisui 35`.
- La entrega de recompensas incluye checkbox por Pokémon.
- El botón **Seleccionar 15** marca automáticamente hasta 15 recompensas pendientes del jugador elegido.
- El botón **C** copia únicamente las recompensas seleccionadas.
- Después de copiar, se habilita **Marcar seleccionados como entregados** para confirmar exactamente ese lote.
- No requiere cambios SQL.
