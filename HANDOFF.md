# Handoff — R∴L∴S∴ Masada No. 324

Documento para retomar el trabajo sin perder el hilo. Última actualización:
**10 de noviembre de 2026**.

> Lee primero el `README.md` de la raíz para el sitio público y
> `tesoreria/README.md` para el sistema de tesorería (qué hace, reglas y
> despliegue). Este documento cubre el **estado actual**, **cómo trabajamos** y
> lo **pendiente**.

---

## Estado actual

| Proyecto | Estado |
|---|---|
| Sitio público (raíz) | En producción, sin cambios de contenido desde el commit `2df2824` |
| Tesorería (`tesoreria/`) | **En producción: https://tesoreria.masada324.org**. Base en la migración **032**. Código: `main` en `90b03ae` (insignia "Plan ajustado"); producción quedó en `8f585f4` y el despliegue de `90b03ae` (sin migraciones) se le mandó al agente: **confirmar que se hizo** |

### Sitio público

Producción coincide con el repositorio. La tenida interlogial del 15 de junio ya
pasó y el sitio publicado todavía la muestra como próxima: un
`bash deploy/publish.sh` lo corrige, no hay cambios de contenido pendientes.

### Tesorería

Sistema interno de tesorería, con registro desde el ejercicio 2026, en producción
desde el 24 de agosto de 2026: usuario de sistema propio, PostgreSQL propio,
systemd, Apache con TLS detrás de Cloudflare y respaldo diario por timer. La
operación del servidor vive en el repo `serverAdmin`, en
`tesoreria-masada-despliegue.md`.

Qué hace (el detalle de cada regla está en `tesoreria/README.md`):

- **Padrón**: hermanos con grado, cargos del cuadro, fechas, contacto, altas y
  bajas, historial de grados.
- **Candidatos** (migración 028): la persona entra como candidato antes de su
  iniciación o afiliación, sin grado, fecha de ingreso ni cápitas, pero ya con su
  cuota, sus pagos y su trámite GT. El día de la ceremonia pasa a hermano desde
  su ficha y conserva todo. Si desiste, queda registrado y se puede retomar.
- **Cuotas de grado por cobrar** (028): iniciación, afiliación, aumento y
  exaltación. Se registra lo que la persona debe cuando la logia ya pagó a la GT;
  los ingresos de esa cuota se le aplican solos en la base, en abonos. Se ven en
  la ficha, el padrón y el tablero.
- **Cápitas**: mensual 500, anual preferencial (promoción, la autoriza el
  V∴M∴; de uno o dos pagos) y prorrateo por meses restantes. **El mes de ingreso
  cuenta solo si fue antes del día 15** (031); la 032 recalculó a los tres que ya
  lo tenían cobrado. Pagos del mes más antiguo hacia adelante, saldos a favor
  (sus salidas nunca son automáticas), exenciones, promoción convertible a
  mensual, adeudo vencido separado de lo "por vencer", matriz anual con la
  historia de cada plan. "Plan ajustado" solo marca un cambio real de modalidad.
- **Ingresos**: cuotas de grado y donativos, con comprobante. Un ingreso
  corregido muestra el original tachado y el neto.
- **Egresos**: registrado, dos firmas, entrega, comprobación. El V∴M∴ suple al
  tesorero con motivo (editable o limpiable). La lista dice qué paga cada egreso
  de GT y muestra lo que GT cobró y aún no tiene egreso. **Corrección de captura**
  (025, nivel V∴M∴): concepto, beneficiario, descripción y fechas, nunca montos.
  Beneficiarios unificables.
- **Gran Tesorería**: obligaciones (ordinarias GT-, regularizaciones REG-,
  extraordinarias) y **trámites** con su pantalla (iniciación, afiliación,
  aumento, exaltación, **ajuste de cápitas** con los meses que cubre, u otro con
  nombre). El pago nace de la obligación, viaja en un egreso con dos firmas y se
  materializa al entregar (GTP-). A plomo derivado solo de las ordinarias.
  Obligaciones corregibles desde su ficha (meses, fecha, clase; nunca monto).
  **Tarifas** = catálogo de la Ley de Ingresos (Ley 2026-2027 cargada, edificio
  sede), como referencia. **Membresías** = solo el documento de la GT, para
  consulta; una registrada por error se elimina (030). Sin conciliación de
  padrones (es asunto de la secretaría). El concepto se llama "Pago a la Gran
  Tesorería" (029).
- **Aportaciones**: monetaria con recibo; en especie con constancia (APO-), fuera
  de la caja.
- **Pendientes de evidencia**, **tablero** con indicadores y gráficas SVG,
  **visor** de comprobantes (HEIC convertido a JPEG al vuelo), **dos bolsas**
  con traspasos, **cortes** mensuales con bloqueo en la base, **carga masiva
  CSV**, **usuarios** (super_admin), **exportación** del cuadro al sitio.

Verificado: 91 pruebas automatizadas en verde (`npm run prueba`), en local y en
el servidor antes de cada migración.

### Decisiones que quedan a ratificación del V∴M∴

1. **Nombre de la modalidad**: "Promoción" se muestra como "Anual preferencial,
   pago único". El valor interno no cambió.
2. **Doble firma** en todos los egresos, pendiente de ratificar en el reglamento.
3. **Prorrateo**: 500 por mes restante desde el ingreso interno; el mes de
   ingreso cuenta solo si fue antes del día 15. El día 15 exacto ya cuenta como
   del mes siguiente (tomado al pie de la letra; nadie ingresó un día 15, así que
   cambiarlo no afectaría datos).
4. **Medio de pago GT**: banco se registra como transferencia, efectivo como
   efectivo. Tarjeta u otro medio se corrige a mano.
5. **Conceptos gl_***: desactivados; el histórico los sigue mostrando.
6. **Membresías**: solo el documento de la GT, sin renglones.
7. **Tarifas anteriores a la Ley 2026-2027**: no están cargadas; se capturan en
   Tarifas GT con fecha y fundamento si se quieren en el historial.
8. **Corrección de captura abierta** a propósito durante el año de captura en
   paralelo a los exceles; cerrarla después.

---

## Cómo trabajamos

- **Arturo** (V∴M∴ 2026) pide los cambios, revisa en pantalla y captura en
  producción. Habla en español; redacción sin guiones largos, con comas, también
  en código, mensajes y pantallas.
- **Este repo**: se desarrolla en local, se verifica (`npm run check`, `npm run
  prueba`, recorrido HTTP con el servidor local) y se hace commit directo a
  `main` **solo cuando Arturo lo pide**. Arturo casi siempre pide "haz commit y
  push, y dame el mensaje para el agente".
- **El push** a veces lo bloquea el modo automático de permisos de Claude Code.
  No se rodea: se le pide a Arturo que corra `! git push origin main`.
- **El despliegue lo hace otro agente**, la sesión `serveradmin-b5` en esta misma
  máquina (repo `serverAdmin`). Este agente **no toca el servidor**. Se le manda
  un brief (Arturo lo pega, o con `SendMessage` si Arturo lo pide) con: commit y
  confirmación de que está en GitHub; migraciones y qué tocan; si hace falta
  `npm ci`; **respaldo obligatorio** si hay migración; `npm run check` exigiendo
  la línea "Result (N files)" con 0 errores; `npm run prueba` con el número
  exacto; consultas de antes y después; migrar **antes** del build; build y
  reinicio; verificación. Para consultas de solo lectura en producción también
  se le pide a ese agente.
- **Pruebas por HTTP en local**: se crea una sesión temporal insertando una fila
  en `sesion` (hash sha256 de un id inventado, csrf `csrfprueba`) para el usuario
  V∴M∴ local, se levanta `npm run dev`, se sacan los nonces del HTML y se hacen
  POST con `Origin`. Al terminar se borra todo lo creado (sesión, filas,
  archivos con su ruta literal) y se corre `npm run limpiar`.

### Trampas aprendidas

- `astro check` **sale con 0 aunque no revise nada** si falta `@astrojs/check`:
  no vale un check sin la línea "Result". `npm audit fix --omit=dev` quita las
  dependencias de desarrollo de `node_modules`; se reparan con `npm ci`.
- Las migraciones son **inmutables** una vez aplicadas (el runner guarda su
  sha256): una corrección es una migración nueva.
- En zsh, `for r in $VAR` no parte por palabras; y `rm` con variables lo bloquea
  la verificación de seguridad: usar rutas literales.
- Los movimientos y las cuotas de grado no se borran (disparadores). Para limpiar
  datos de prueba en local se desactiva el disparador dentro de la transacción y
  se vuelve a activar.
- Al contar pruebas para el brief, usar el número que imprime `npm run prueba`,
  no sumarlo a mano.

---

## Pendientes operativos (de Arturo, en la interfaz)

Al 10 de noviembre, sin confirmar si ya se hicieron:

1. **Confirmar el despliegue de `90b03ae`** y ver en la matriz de Cápitas que
   Adolfo, David y José Antonio ya no tienen "Plan ajustado" y Miller sí.
2. **Ricardo Acosta Monarrez**: alta como hermano iniciado el 11 de mayo de 2026,
   cuota de iniciación por cobrar de 4,500 desde su ficha, su trámite de
   iniciación en GT con su recibo y su egreso, y su modalidad en Cápitas.
3. **Eliminar la membresía de octubre 2026 duplicada** (la que no dice "Más
   reciente"), desde su ficha, con motivo.
4. **Probar el visor con el HEIC real de iPhone**: abrir `IMG_5296.heic` en los
   documentos de EG-2026-0013.
5. Opcional: corregir la descripción de EG-2026-0013 desde "Corregir la captura"
   (los egresos de GT viejos dicen solo el folio; los nuevos ya dicen qué pagan).
6. **Crear la cuenta del Tesorero** (Herramientas → Administrar usuarios).
7. **Atender el panel de Pendientes** y **cerrar los cortes** de los meses
   terminados, en orden.
8. **Confirmar el saldo de apertura** de 2026, si sigue en cero.
9. **La tarifa GT que ya existía antes de la 026**: está en el historial sin
   fundamento; decidir si se cierra.
10. **Corregir las fechas de los egresos de GT** capturados con la fecha del día
    de captura, y unificar los dos nombres de la Gran Logia en Beneficiarios.

### Datos reales que conviene conocer

- **Cristian Colin Chavero**: iniciado en noviembre de 2025; su trámite no se
  concluyó y en 2026 se pagó un **ajuste de cápitas** de dic 2025 a oct 2026,
  2,750 (GT-2026-0011, recibo Aju-124396, egreso EG-2026-0013, pagado en
  efectivo con el recibo como comprobante).
- **Iniciados el 11 de mayo de 2026**: Diego Joseph Mesino Resendiz, Mauricio
  Homer y Ricardo Acosta Monarrez. Ricardo debe 4,500 de su cuota de iniciación
  y está fuera del país; su pago a la GT lleva recibo propio.
- **Iniciados el 29 de agosto de 2026**: Adolfo Ponce de León Lima, David Israel
  Arana Bernal y José Antonio Sanabria Fragoso; recalculados por la regla del 15
  (cápitas de septiembre a diciembre).
- **Miller**: promoción de dos pagos convertida a mensual desde julio (el caso
  que originó la conversión).

---

## Pendientes de código

- [ ] **Comentarios de Arturo sobre las pestañas**: atendidos el 6 (egresos) y el
      7 (Gran Tesorería), y después los casos que fue trayendo (ajuste de cápitas,
      candidatos, cuotas de grado, membresías, regla del 15). Preguntarle por los
      que sigan.
- [ ] (Opcional, ofrecido) En la ficha de un trámite GT: título "Trámite" en vez
      de obligación, renglón Tipo sin repeticiones y una sola fecha.
- [ ] **Cerrar la puerta de la corrección de captura** cuando termine el año en
      paralelo.
- [ ] **Copia externa de los respaldos**: hoy el respaldo diario vive solo en el
      VPS.
- [ ] **Confirmar que el repo público es deliberado** (`marturojt/masada` es
      público; no tiene secretos, pero el modelo de datos es legible).
- [ ] **Desplegar el sitio**: `bash deploy/publish.sh`.
- [ ] **Módulo de control interno de grados** (a futuro).
- [ ] **Histórico completo de Past Masters** (hoy 2022 a 2025).
- [ ] (Opcional) Limpiar el código inerte de la insignia "Vigente" en Past
      Masters de `cuadro-logial.astro`.

### Historial de despliegues de la tesorería

| Fecha | Commit | Migraciones | Qué |
|---|---|---|---|
| 2026-08-24 | | hasta 024 | Alta en producción |
| 2026-10-05 | `bea099e` | 025, 026 | Corrección de captura, Ley de Ingresos GT, sin conciliación |
| 2026-10-10 | `462a4e3` | | Seguridad: astro 7.3.8, @astrojs/node 11.1.7, `/_image` en 404 |
| 2026-11-10 | `c03bfe7` | 027 | Ajuste de cápitas, corrección de obligaciones |
| 2026-11-10 | `efc0f50` | 028 | Candidatos y cuotas de grado |
| 2026-11-10 | `0b50432` | 029 | Concepto "Pago a la Gran Tesorería" |
| 2026-11-10 | `19ca089` u `8f585f4` | 030 | Membresía solo documento (entró sola o con la siguiente; no se confirmó) |
| 2026-11-10 | `8f585f4` | 031, 032 | Regla del día 15 y recálculo de los tres casos |
| pendiente | `90b03ae` | | Insignia "Plan ajustado" |

---

## Notas de contexto

- **Dato del cuadro:** Mario Arturo Jiménez Terrón es el **V∴M∴ vigente 2026**;
  por eso NO está en Past Masters.
- **Imágenes del sitio:** flyers de eventos en `public/images/eventos/`, 4:5.
- **Comprobantes de la tesorería:** viven en `tesoreria/comprobantes/`, fuera del
  sitio, y no se versionan. Van en el mismo respaldo que la base.
- **Base local**: `masada_tesoreria` es solo desarrollo, con datos de prueba.
  Producción arrancó limpia y la captura real se hace ahí.
- `node_modules` no se versiona: `npm install` en la raíz y en `tesoreria/` tras
  clonar.
