# Tesorería, R∴L∴S∴ Masada No. 324

Sistema interno de tesorería de la logia. Lleva el padrón de hermanos, el cobro de
cápitas, los ingresos y egresos con sus comprobantes, la doble firma del tesorero y
el Venerable Maestro, y los cortes mensuales.

Es una aplicación **aparte** del sitio público. El sitio vive en la raíz del
repositorio y sigue siendo estático; esta carpeta es la única que necesita base de
datos y un proceso corriendo. `deploy/publish.sh` del sitio no cambia.

## Qué necesitas

- Node 22.12 o más nuevo (aquí se probó con 26.5)
- PostgreSQL 16 corriendo en local
- El repositorio del sitio en la carpeta de arriba, para poder exportar el cuadro

## Primera vez

```bash
cd tesoreria
npm install

createdb masada_tesoreria
cp .env.example .env && chmod 600 .env    # revisa DATABASE_URL y COMPROBANTES_DIR

npm run estilos       # copia tokens.css y global.css del sitio
npm run migrar        # crea el esquema
npm run sembrar       # crea el Tesorero y el Venerable Maestro (interactivo)
npm run dev           # http://127.0.0.1:4322
```

`npm run sembrar` pide correo, nombre, rol y contraseña de cada usuario, sin
mostrar lo que escribes. La contraseña debe tener al menos 14 caracteres: una
frase con espacios sirve y se recuerda mejor que una clave con símbolos.

Para importar el padrón desde el cuadro logial publicado, en vez de capturar los
mismos nombres dos veces:

```bash
npm run sembrar -- --desde-sitio
```

Trae nombre, grado y cargo. Las fechas de ingreso quedan como regularización al
31 de diciembre del año anterior, que es lo correcto para quien ya estaba en la
logia, y hay que completar a mano las fechas reales de iniciación y el contacto.

## Uso diario

| Sección | Para qué |
|---|---|
| Hermanos | Padrón, grados, cargos del cuadro, altas y bajas |
| Cápitas | Modalidad de cada hermano, pagos, quién está al corriente, exenciones |
| Ingresos | Cuotas de grado del candidato, donativos |
| Aportaciones | Aportaciones extraordinarias: monetarias con recibo y en especie con constancia |
| Egresos | Solicitud, doble firma, entrega, comprobación |
| Gran Tesorería | Membresías, tarifas GT, obligaciones y pagos, estado a plomo, conciliación |
| Traspasos | Depósitos del efectivo al banco y retiros, con su ficha |
| Cortes | Cierre mensual, saldos encadenados por bolsa, hoja imprimible |
| Conceptos | Catálogo administrable de ingresos y egresos |
| Herramientas | Saldo de apertura, carga masiva por CSV, exportación del cuadro, contraseña |

### El orden de las cosas

1. **Captura el saldo de apertura** del ejercicio en Herramientas, separado en
   banco y efectivo. De ahí se encadenan todos los saldos de los cortes.
2. **Asigna la modalidad de cápita** a cada hermano. Sin modalidad no se le puede
   registrar un pago, a propósito: el pago tiene que saber a qué mes se aplica.
3. Captura ingresos y egresos conforme ocurren.
4. **Cierra cada mes** cuando ya no falte nada. Un mes cerrado deja de admitir
   capturas.

### Las tres modalidades de cápita

| Modalidad | Monto | Para quién |
|---|---|---|
| Mensual | 500 al mes, 6,000 al año | Quien está desde enero |
| Anual preferencial | 5,000 en un solo pago | Quien está desde enero, y la habilita el V∴M∴ |
| Prorrateo | 500 por mes restante | Quien se inicia o afilia dentro del año |

La anual preferencial la autoriza únicamente el Venerable Maestro, en cualquier
mes del año. Si el hermano ya pagó meses, se le descuentan: habilitarla en agosto
con 2,000 ya pagados son 3,000 por cubrir. El sistema no deja asignar una
modalidad que no corresponda al mes de ingreso, y lo explica cuando pasa. El
prorrateo cuenta desde la fecha de ingreso interna, sin depender de cuándo
reconozca al hermano la Gran Tesorería.

Las tarifas viven en la tabla `ejercicio`, no en el código: el día que cambien,
los ejercicios anteriores conservan las suyas.

### Egresos

Un egreso pasa por: **registrado** → **autorizado** (dos firmas) → **pagado** o
**por comprobar** → **comprobado**.

- El dinero sale de la caja al registrar la entrega, ni antes ni después.
- Todo egreso pagado directo necesita imagen del comprobante.
- Los que se entregan por comprobar cierran cuando los recibos más la devolución
  del sobrante suman lo entregado.
- El **V∴M∴ puede firmar por el tesorero** cuando no está, anotando el motivo. Al
  revés no: el tesorero no puede firmar por el V∴M∴, y eso lo impide la base.
- El **pago a la Gran Tesorería** no se captura como egreso suelto: nace de una
  obligación en el módulo Gran Tesorería (abajo), que genera el egreso con sus
  dos firmas. Al registrar la entrega, el pago GT y su aplicación a la obligación
  se materializan solos.

### Gran Tesorería

Módulo propio, porque son tres realidades administrativas distintas: el padrón
interno lo gobierna la logia, la Gran Secretaría formaliza la pertenencia y la
Gran Tesorería determina el cobro. Lo que cada organismo sabe de un hermano se
registra en su ficha y las diferencias se ven en la **conciliación de padrones**,
que informa y nunca bloquea.

- **Membresías**: el documento con el que GT dice a quién reconoce y por quién
  cobra. Se captura tal como llega, renglón por renglón, y después se liga cada
  renglón con el padrón; ligar actualiza solo el estatus del hermano ante GT.
- **Tarifas GT** (cápita, templo, locker): sirven para el cálculo esperado. Solo
  aplican hacia adelante, nunca en retroactivo.
- **Obligaciones**: lo exigible es lo que GT reporta en su documento (folios GT-
  ordinarias, REG- regularizaciones). El esperado interno solo concilia: una
  diferencia se muestra, no bloquea. Una regularización es una obligación nueva,
  jamás toca meses ya cerrados.
- **Pagos**: de las obligaciones pendientes se genera un egreso normal con dos
  firmas; la entrega materializa el pago (GTP-) y sus aplicaciones. La base
  impide aplicar más que el pago o que la obligación, y una obligación con pagos
  ya no se cancela ni cambia de monto.
- **A plomo**: estado derivado, meses ordinarios cubiertos hasta el mes corriente.
  Los trámites con la logia sin estar a plomo se avisan, no se impiden: la
  palabra final la tiene la Gran Tesorería.

Las cápitas internas y lo que se paga a GT están **desacoplados a propósito**: los
500 del hermano a Masada son ingreso ordinario de libre uso; los de GT son un
egreso institucional. Nada se reserva ni se calcula automáticamente entre ambos.

### Carga masiva por CSV

Para capturar mucho de golpe (el arranque del ejercicio, por ejemplo) sin perder
ninguna regla. En Herramientas → Carga masiva:

1. **Descargar la plantilla**: la de hermanos trae el padrón actual con su id;
   las de ingresos y egresos traen las columnas y las claves válidas como notas.
2. **Subir el archivo lo ensaya**: valida cada fila con las mismas reglas de la
   captura manual y muestra qué haría, sin escribir nada.
3. **Aplicar** lo mete completo en una sola transacción: si una fila tiene
   error, no entra ninguna.

Lo que respeta, a propósito: los hermanos con id se actualizan y las celdas
vacías conservan lo que ya está; los pagos de cápita exigen modalidad asignada y
se aplican con el mismo FIFO del módulo; los **egresos nacen registrados**, sus
dos firmas y su entrega con comprobante siguen siendo manuales; y los pagos a la
Gran Tesorería no van por aquí, se capturan como obligaciones en su módulo. Los
comprobantes se adjuntan después, a mano, donde hagan falta. Cada carga queda en
la bitácora y el reenvío del formulario no la duplica.

Las fechas de **iniciación, aumento de salario y exaltación** de la plantilla de
hermanos completan el historial de grados, pero solo si el hermano no tiene ya
un evento de ese tipo, y nunca recalculan el grado vigente: un maestro al que
solo se le llenó la iniciación sigue siendo maestro. Corregir una fecha ya
capturada se hace en la ficha del hermano, viendo el historial completo.

Sobre el **motivo de ingreso**: para los hermanos de años atrás de los que no se
sabe si nacieron en Masada o llegaron de otra logia, el valor es
`regularizacion`, que en pantalla se lee "Miembro de años anteriores". Significa
exactamente eso: ya era miembro cuando el sistema arrancó y su origen no está
documentado. Si algún día aparece el dato real, se corrige en su ficha.

### Aportaciones

Dos naturalezas que no se mezclan. La **monetaria** es un ingreso normal: entra a
una bolsa, genera movimiento y recibo. La **en especie** (sillas, comida, un
cuadro) queda registrada con su constancia imprimible (folio APO-) y jamás toca el
libro de caja: su valor estimado es informativo y no entra en ningún saldo.

### Cortes

Se cierran en orden. Al cerrar un mes, sus movimientos quedan sellados y el mes
se bloquea **en la base de datos**, no solo en la interfaz.

Para corregir un mes ya cerrado hay dos caminos, y el primero es el normal:

1. **Movimiento de ajuste**: uno de signo contrario en el mes abierto, ligado al
   original, con motivo. Lo autoriza el V∴M∴.
2. **Reapertura**: solo del último mes cerrado, solo el V∴M∴, y deja huella
   permanente. Es excepcional: los cortes ya se leyeron en tenida.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en 127.0.0.1:4322 |
| `npm run migrar` | Aplica migraciones pendientes. `-- --seco` solo las lista |
| `npm run sembrar` | Usuarios iniciales. `-- --agregar`, `-- --desde-sitio` |
| `npm run contrasena -- --correo <correo>` | Cambia una contraseña y revoca sesiones |
| `npm run estilos` | Copia tokens.css y global.css del sitio |
| `npm run exportar:cuadro` | Muestra el diff del cuadro. `-- --escribir` lo aplica |
| `npm run respaldo` | Respaldo de base y comprobantes, con manifiesto |
| `npm run limpiar` | Comprobantes sueltos. `-- --borrar` los elimina |
| `npm run check` | Tipos y verificación de guardias de sesión |
| `npm run prueba` | Pruebas contra una base de pruebas aparte |
| `npm run build` | Compila para producción |

## Respaldos

```bash
npm run respaldo
bash scripts/restaurar.sh respaldos/tesoreria-AAAAMMDD-HHMM.dump
```

El respaldo son **dos archivos**: el volcado de la base y el tar de comprobantes.
Van juntos: una base sin comprobantes es un libro sin evidencia. Guarda una copia
fuera de esta máquina.

Un respaldo que nunca se ha restaurado no es un respaldo: `restaurar.sh` lo
restaura en una base aparte y cuenta hermanos, movimientos y cortes para que
compares.

## Exportar el cuadro al sitio

El padrón de este sistema es la fuente de verdad; el JSON del sitio se genera de
aquí.

```bash
npm run exportar:cuadro              # muestra qué cambiaría
npm run exportar:cuadro -- --escribir
cd .. && npm run build               # valida el esquema del sitio
```

Solo cruzan **nombre, grado y cargo**. Ni correos, ni teléfonos, ni fechas, ni
montos: ese archivo termina publicado en internet. La restricción está en la vista
`v_cuadro_json`, otra vez en el script, y hay una prueba que falla si alguna vez
se cuela un campo sensible.

El arreglo `maestros` lleva solo a los maestros **sin cargo**, porque la página
del sitio arma esa columna uniendo dignatarios, oficiales y ese arreglo.

### Las dos bolsas

Cada movimiento dice por dónde entró o salió el dinero: **banco** o **efectivo**.
Con eso el corte muestra el saldo de cada bolsa, se puede hacer arqueo (contar el
sobre y compararlo contra el sistema) y conciliar contra el estado de cuenta del
banco.

Cuando el efectivo de las tenidas se deposita a la cuenta, eso es un **traspaso**:
no es ingreso ni egreso, el total no cambia, solo el lugar del dinero. Se registra
en su propio módulo, con la ficha de depósito. Un movimiento capturado en la bolsa
equivocada no se edita: se corrige con un traspaso, que es lo que de hecho pasó.

## Cómo está hecho

```
tesoreria/
├─ migraciones/     esquema en SQL plano, numeradas, inmutables una vez aplicadas
├─ scripts/         operación: migrar, sembrar, exportar, respaldar, limpiar
├─ pruebas/         node:test contra PostgreSQL de verdad
└─ src/
   ├─ middleware.ts    resuelve la sesión y pone cabeceras. NO autoriza
   ├─ lib/
   │  ├─ datos/        una función por consulta, siempre parametrizada
   │  ├─ casos/        transacciones de dominio, con sus invariantes
   │  └─ esquemas/     validación con zod, mensajes en español
   ├─ componentes/     formularios y tablas, sin JavaScript de cliente
   └─ pages/           una página por pantalla, POST a sí misma
```

### Decisiones que conviene conocer antes de tocar el código

**Las reglas de dinero viven en la base, no en la interfaz.** El bloqueo del mes
cerrado, la doble firma, el tope de lo que se puede aplicar a un mes y la máquina
de estados de un egreso son triggers y constraints de PostgreSQL. Un POST directo
que se salte la interfaz choca con las mismas reglas. La interfaz solo las explica
antes de que truenen.

**El dinero son enteros de centavos.** Nunca float. `lib/dinero.ts` es la única
frontera entre esos enteros y lo que lee una persona.

**El libro de caja no se reescribe.** Los movimientos no se borran, lo impide un
trigger. Una equivocación se corrige con un movimiento de ajuste que apunta al
original.

**La autorización es explícita en cada página**, con `requerirSesion` o
`requerirVM`, además del middleware que cierra por omisión. `npm run check` falla
si una página nueva olvida el guard.

**Formularios HTML clásicos**, POST a la propia página y redirect 303. Todo
funciona con JavaScript desactivado. Cada formulario lleva un token CSRF de la
sesión y un **nonce de un solo uso**: un doble clic o un F5 con reenvío no duplica
un asiento de dinero.

**Los comprobantes se validan por sus primeros bytes**, no por la extensión ni por
lo que declare el navegador. Se guardan fuera del webroot y solo se sirven con
sesión válida. No se transcodifican: el original es el dato probatorio.

**Los estilos se copian del sitio**, no se importan por ruta relativa: así esta
carpeta se puede construir sola. `npm run estilos` los sincroniza y el build avisa
si divergieron.

## Despliegue

La tesorería está **en producción en https://tesoreria.masada324.org** desde el
24 de agosto de 2026 (subdominio sin acento, propio y separado del sitio público,
que sigue en masada324.org sin cambios). Lo que sigue documenta cómo quedó
montada; sirve de referencia para reconstruirla o para montar un ambiente igual.

El sitio público no se toca: su despliegue sigue siendo `deploy/publish.sh` desde
la raíz y ninguna de las dos aplicaciones puede tirar a la otra.

### Cómo está montada (y cómo se volvería a montar)

1. **Usuario de sistema propio** (`tesoreria`), sin shell de login si se puede.
   Código en `/home/tesoreria/app` (clon del repo, se usa solo `tesoreria/`),
   comprobantes en `/home/tesoreria/comprobantes` con modo 700 y dueño de ese
   usuario. Los comprobantes son datos del tesorero, no código: sobreviven a
   cualquier redeploy y van en el respaldo junto con la base.

2. **PostgreSQL**: rol y base propios, por ejemplo:
   ```sql
   create role tesoreria login;
   create database masada_tesoreria owner tesoreria;
   ```
   Conexión por socket unix de preferencia:
   `postgres:///masada_tesoreria?host=/var/run/postgresql`.

3. **Aplicación** (Node 22.12 o más nuevo):
   ```bash
   cd /home/tesoreria/app/tesoreria
   npm ci
   cp .env.example .env && chmod 600 .env
   npm run migrar
   npm run sembrar       # interactivo, crea el Tesorero y el V∴M∴
   npm run build
   ```
   El `.env` de producción cambia respecto al de local exactamente en esto:
   ```
   DATABASE_URL=postgres:///masada_tesoreria?host=/var/run/postgresql
   COMPROBANTES_DIR=/home/tesoreria/comprobantes
   TS_ORIGEN=https://tesoreria.masada324.org
   TS_ENTORNO=produccion
   TS_COOKIE_NOMBRE=__Host-ts_sesion
   TS_CONFIAR_PROXY=true
   HOST=127.0.0.1
   PORT=4322
   ```

4. **Unidad systemd** con `Restart=always`, `NODE_ENV=production`,
   `ExecStart=/usr/bin/node dist/server/entry.mjs`, `User=tesoreria`,
   `ProtectSystem=strict` y `ReadWritePaths` acotado a comprobantes y respaldos.
   El proceso escucha solo en 127.0.0.1:4322, nunca expuesto directo.

5. **Apache**: vhost de `tesoreria.masada324.org` con TLS (certbot), proxy
   inverso a `http://127.0.0.1:4322`, `LimitRequestBody 10485760` para las
   subidas, y en el borde **quitar** las cabeceras `X-Forwarded-Host` y
   `Forwarded` que vengan del cliente (la app confía en el proxy con
   `TS_CONFIAR_PROXY=true`, así que el proxy debe ser quien las controle).

6. **Respaldo diario** por timer de systemd: `npm run respaldo` genera el volcado
   de la base y el tar de comprobantes, con manifiesto. Van juntos siempre, con
   copia fuera del servidor. Un respaldo no probado no es respaldo:
   `bash scripts/restaurar.sh <dump>` lo restaura en una base aparte y compara
   conteos.

7. **Verificación**: entrar a https://tesoreria.masada324.org, iniciar sesión y
   recorrer el tablero. `masada324.org` debe seguir sirviendo el sitio de siempre.

### Lo que se encontró al ejecutarlo (2026-08-24)

El procedimiento se ejecutó por primera vez en el VPS. Tres cosas que el diseño
asumía y no se cumplían:

1. **`security.allowedDomains` era obligatorio, no opcional.** Su default es
   `[]`, y con la lista vacía Astro **ignora `Host` y todas las `X-Forwarded-*`**
   y arma `url.origin` como `http://localhost:4322`. Como `checkOrigin` compara
   la cabecera `Origin` del navegador contra `url.origin`, detrás del proxy
   **todo POST daba 403**. Está corregido en `astro.config.mjs`, con el dominio
   de producción y las dos variantes locales. Comprobado contra los módulos
   reales de Astro (`validate-headers.js` y `origin-check.js`): antes
   `http://localhost:4322` → 403, después `https://tesoreria.masada324.org`
   → pasa. De paso, `astro dev` ahora funciona por `127.0.0.1` además de por
   `localhost`; antes solo por `localhost`.

2. **El Node del sistema es 20.19.2 y `astro@7.2.2` exige `>=22.12.0`.** No se
   subió el Node del sistema porque lo comparten otras seis aplicaciones del
   servidor. Hay un Node 22 LTS aislado en
   `/opt/nodejs/node-v22.23.2-linux-x64/bin/node`, que es el que usan la unidad
   de systemd y los comandos de mantenimiento. **Para correr `npm`, `migrar`,
   `sembrar` o `respaldo` en el VPS hay que usar ese Node, no el del `PATH`.**

3. **`masada324.org` está detrás de Cloudflare con el proxy activo.** Eso agrega
   un salto: Cloudflare manda `X-Forwarded-For: <cliente>` y Apache le añade la
   IP de Cloudflare, así que `ipDelCliente()`, que toma el último salto, veía la
   IP de Cloudflare y no la del usuario, y la bitácora quedaba inservible.
   Resuelto en el borde con `mod_remoteip` y `CF-Connecting-IP`, sin tocar el
   código: la app sigue tomando el último salto y ahora ese salto es el cliente
   real. El límite de intentos por IP (25) ya toleraba IP compartida, así que
   esto nunca fue riesgo de bloqueo, solo de trazabilidad.

El detalle de operación del lado servidor (unidad de systemd, vhost, respaldo
por timer, cómo reiniciar) vive en el repo `serverAdmin`, en
`tesoreria-masada-despliegue.md`.
