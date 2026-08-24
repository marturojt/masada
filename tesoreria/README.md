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
| Herramientas | Saldo de apertura, exportación del cuadro, cambio de contraseña |

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

## Si algún día se despliega

Hoy todo corre en local. Cuando toque publicarlo, el camino que encaja con el VPS
de la logia es:

- Usuario de sistema propio, código en `/home/tesoreria/app`, comprobantes en
  `/home/tesoreria/comprobantes` con modo 700.
- Unidad systemd con `Restart=always`, `NODE_ENV=production`, bind a `127.0.0.1`,
  `ProtectSystem=strict` y `ReadWritePaths` acotado a comprobantes y respaldos.
- Apache como proxy inverso en un **subdominio propio**, no en una subruta del
  sitio público: así las cookies quedan aisladas y se puede usar el prefijo
  `__Host-`. Con `LimitRequestBody` para las subidas y quitando las cabeceras
  `X-Forwarded-Host` y `Forwarded` en el borde.
- Rol y base propios en PostgreSQL, `.env` en modo 600, `TS_ENTORNO=produccion` y
  `TS_CONFIAR_PROXY=true`.
- Respaldo diario por timer, con copia fuera del servidor.

Nada de esto está probado todavía: son las condiciones que el diseño ya asume, no
un procedimiento verificado.
