# Handoff — R∴L∴S∴ Masada No. 324

Documento para retomar el trabajo. Última actualización: **6 de octubre de 2026**.

> Lee primero el `README.md` de la raíz para el sitio público y
> `tesoreria/README.md` para el sistema de tesorería. Este documento cubre el
> **estado actual** y lo **pendiente**.

---

## Estado actual

El repositorio tiene dos proyectos:

| Proyecto | Estado |
|---|---|
| Sitio público (raíz) | En producción, sin cambios de contenido desde el commit `2df2824` |
| Tesorería (`tesoreria/`) | **En producción: https://tesoreria.masada324.org**. Producción coincide con `main` en `bea099e`, última migración 026, desplegada el 5 de octubre de 2026 con respaldo previo (`tesoreria-20261005-1846.dump`) |

### Sitio público

Producción coincide con el repositorio. Las únicas diferencias que aparecen al
comparar el build de hoy contra https://masada324.org son por la fecha: la tenida
interlogial del 15 de junio ya pasó, así que el sitio publicado todavía la muestra
como próxima y con el botón de confirmar asistencia. Un `bash deploy/publish.sh`
lo corrige, no hay cambios de contenido pendientes.

Páginas: home, cuadro logial, eventos (índice y detalle), noticias (índice, detalle
y por etiqueta), ingreso.

### Tesorería

Sistema interno de tesorería, con registro desde el ejercicio 2026. **Ya está en
producción** en https://tesoreria.masada324.org: usuario de sistema propio, base
propia de PostgreSQL, systemd, Apache como proxy con TLS y respaldo diario por
timer. El detalle de operación del servidor vive en el repo `serverAdmin`, en
`tesoreria-masada-despliegue.md`. El despliegue real destapó tres cosas que ya
quedaron corregidas y anotadas al final de `tesoreria/README.md`
(`security.allowedDomains`, Node 22 aislado en `/opt`, Cloudflare y la IP real
del cliente).

- **Padrón**: hermanos con grado, cargos del cuadro, fechas, contacto, altas y
  bajas, historial de grados.
- **Cápitas**: las tres modalidades (mensual 500, promoción 5,000 que autoriza el
  V∴M∴, y prorrateo por meses restantes), pagos que se aplican del mes más antiguo
  hacia adelante, saldos a favor, exenciones autorizadas por el V∴M∴, matriz anual
  y estado de cuenta por hermano.
- **Ingresos**: cuotas de grado del candidato y donativos, con comprobante opcional.
- **Egresos**: registrado, autorizado con dos firmas, entregado y comprobado.
  El V∴M∴ puede suplir la firma del tesorero dejando constancia. Comprobante de
  imagen obligatorio en los pagados. Gastos por comprobar con recibos y devolución.
  La lista muestra fecha de entrega, el folio GTP- de los pagos a GT y las
  obligaciones GT que aún no tienen egreso.
- **Corrección de captura** (migración 025, nivel V∴M∴): desde la ficha del
  egreso se corrigen concepto, beneficiario, descripción y fechas, nunca montos;
  la fecha de entrega arrastra al movimiento y al pago GTP-. El motivo de una
  suplencia se edita o se limpia con constancia. Los beneficiarios escritos de
  dos maneras se unifican en Egresos → Beneficiarios. Todo en bitácora con
  antes y después.
- **Gran Tesorería**: dominio propio. Obligaciones con lo que GT reporta (GT- y
  REG-), pago que nace de la obligación, viaja en un egreso con dos firmas y se
  materializa al entregar (GTP-), estado a plomo derivado. El egreso generado
  nace con la fecha del documento GT. Las tarifas son el catálogo de la Ley de
  Ingresos (migración 026, Ley 2026-2027 cargada, edificio sede), como
  referencia y sin cálculo esperado. Las membresías son respaldo de consulta,
  sin liga con el padrón. La conciliación de padrones se retiró: es asunto de
  la secretaría. Lo interno y lo de GT están desacoplados: nada se reserva solo.
- **Aportaciones**: la monetaria es ingreso normal con recibo; la de especie deja
  constancia imprimible (APO-) y jamás toca el libro de caja.
- **Registros externos por hermano**: en la ficha, lo que la Gran Secretaría y la
  Gran Tesorería saben de él, con su estatus y fechas.
- **Informe mensual ampliado**: el corte y su hoja imprimible traen resumen por
  clasificación, sección de Gran Tesorería y aportaciones en especie fuera de las
  cifras.
- **Usuarios de la plataforma**: ABC en la interfaz (solo nivel V∴M∴) con el rol
  nuevo super_admin, del mismo nivel que el V∴M∴: firma en su lugar sin ser
  suplencia y puede suplir al tesorero con motivo (migración 016). Candados: nadie
  se desactiva ni se baja de nivel a sí mismo y siempre queda un usuario activo de
  nivel V∴M∴. Los usuarios se desactivan, nunca se borran. En 2026 la cuenta del
  V∴M∴ (Arturo) cubre ambos papeles; en el cambio de año se le cambia el rol a
  super_admin y el V∴M∴ entrante recibe el suyo, en ese orden.
- **Trámites GT con su pantalla** (iniciación, afiliación, aumento, exaltación u
  otro trámite administrativo con nombre, como una carta de regularidad): una
  fecha de solicitud, un hermano, lo cobrado; no amparan meses ni cuentan para el
  a plomo. Las dos promociones reales son opciones explícitas (5,000 un pago,
  5,500 dos pagos, tarifas del ejercicio) y una promoción con pagos se puede
  **convertir a mensual** (lo pagado la salda, el resto se condona, nacen
  mensualidades desde el mes acordado); la reasignación normal con promoción
  pagada está bloqueada en la base.
- **Adeudos honestos**: lo que se muestra es lo VENCIDO (meses anteriores al mes
  en curso); lo que falta del año va aparte como "por vencer". Los ajustes tienen
  tope acumulado en la base, candado antirrepetición de 30 minutos, y un
  movimiento corregido muestra el original tachado, el neto en negritas y la
  insignia Corregido; el recibo ampara el neto.
- **Panel de Pendientes**: todo lo capturado sin su documento, con adjuntar o
  cierre "sin evidencia formal" con motivo en bitácora.
- **Tablero tipo dashboard**: indicadores (caja, cápitas vencidas, semáforo GT,
  evidencias, cortes) y gráficas SVG del servidor (flujo mensual, saldo al
  cierre, avance de cápitas), sin JavaScript.
- **Visor de comprobantes**: imágenes en overlay CSS sin JavaScript y HEIC
  convertido a JPEG al vuelo con caché (.visor.jpg); el original nunca se toca.
- **Cápitas con historia**: la modalidad de cada hermano explica su caso al
  pasar el cursor (promoción con quién la autorizó, el plan convertido de Miller
  con su insignia Plan ajustado), y un mes vencido con pago parcial se pinta
  ámbar, no rojo.
- **Carga masiva por CSV** (Herramientas): plantilla con el padrón actual para
  actualizar o dar de alta hermanos en lote, y captura de ingresos y egresos
  desde archivo, con ensayo previo y todo o nada. Las cápitas aplican con el
  mismo FIFO; los egresos cargados nacen registrados y sus firmas, entrega y
  comprobante siguen siendo manuales.
- **Dos bolsas**: cada movimiento indica banco o efectivo, hay traspasos entre
  bolsas (depósitos y retiros, con ficha) y los cortes muestran el saldo por bolsa.
- **Cortes mensuales**: saldos encadenados por bolsa, cierre en orden, bloqueo del
  mes en la base de datos, movimientos de ajuste, reapertura excepcional del V∴M∴
  con huella, y hoja imprimible.
- **Exportación** del cuadro logial al sitio público, con solo nombre, grado y cargo.

Verificado: 82 pruebas automatizadas en verde (`npm run prueba`), en local y en
el servidor antes de migrar, y un recorrido completo por HTTP en una base aparte
(obligación → egreso con dos firmas → entrega → pago GT aplicado; aportaciones
con recibo y constancia). El respaldo se probó restaurándolo en una base aparte.

### Decisiones que quedan a ratificación del V∴M∴

Nada de esto bloquea el uso, son las convenciones que el sistema asumió y que
conviene confirmar o corregir:

1. **Nombre de la modalidad**: "Promoción" ahora se muestra como "Anual
   preferencial, pago único". El valor interno no cambió, el histórico se conserva.
2. **Doble firma**: se mantiene en todos los egresos, marcada como pendiente de
   ratificación en el reglamento interno.
3. **Prorrateo**: la capacidad sigue igual (500 por mes restante desde el ingreso
   interno); su definición funcional fina quedó pendiente a propósito.
4. **Medio de pago GT**: al entregar por banco se registra "transferencia", por
   efectivo "efectivo". Si un pago fue con tarjeta u otro medio, se corrige a mano.
5. **Conceptos gl_***: los conceptos viejos de Gran Logia quedaron desactivados;
   el histórico los sigue mostrando.
6. **Renglones de membresía**: se capturan tal como GT los reporta y no se editan
   ni se ligan con el padrón: la membresía es respaldo de consulta.
7. **Tarifas anteriores a la Ley 2026-2027**: el sistema trae cargada la ley
   vigente desde el 21 de septiembre de 2026. Las de antes, si se quieren en el
   historial, se capturan en Tarifas GT con su fecha y su fundamento.

---

## Estado de la operación (octubre 2026)

Arturo ya capturó el año en producción: padrón completo (28 hermanos), cápitas
con sus modalidades (incluidos los casos especiales: promociones de uno y dos
pagos, y la conversión de Miller), ingresos con recibos, obligaciones y pagos a
la Gran Tesorería (al corriente en lo ordinario), y los dos ajustes del
incidente de captura, ya corregidos y con recibos en neto. Pendientes
operativos, todos de interfaz:

1. **Crear la cuenta del Tesorero** (ya se puede sin SSH: Herramientas →
   Administrar usuarios). El único usuario sigue siendo el V∴M∴.
2. **Atender el panel de Pendientes**: los comprobantes que falten se adjuntan,
   y lo que no tenga respaldo se cierra como "sin evidencia formal" con motivo.
3. **Cerrar los cortes** de los meses terminados, en orden (al último corte de
   situación no había ninguno cerrado).
4. **Confirmar el saldo de apertura** de 2026 en Herramientas, si aún está en
   cero.
5. **Revisar lo desplegado el 5 de octubre con sesión** (el agente no lo probó
   con sesión): tablero, Egresos, Egresos → Beneficiarios, Tarifas GT, y que
   `/gran-tesoreria/conciliacion` dé "No encontrado".
6. **La tarifa GT que ya existía**: antes de la 026 había una sola fila en
   `gt_tarifa`. Está en el historial de Tarifas GT, sin fundamento. Si era la
   cápita, ya la sustituye la ley; si era templo, locker u otro, sigue vigente
   junto a las de la ley y hay que decidir si se cierra.
7. **Corregir las fechas de los egresos de GT** capturados con la fecha del día
   de captura: desde su ficha, "Corregir la captura". Unificar los dos nombres
   de la Gran Logia en Beneficiarios.
8. **Tarifas anteriores a la Ley 2026-2027**, si se quieren en el historial:
   Arturo pasará los montos.

### Nota sobre la base local

La base `masada_tesoreria` de la máquina de desarrollo tiene capturas de prueba
(una obligación GT pagada, tarifas, membresías). **No se migró a producción a
propósito**: producción arrancó limpia y la captura real se hace ahí. Lo local
queda como ambiente de desarrollo.

---

## Pendientes de código

- [x] **Desplegar `ce831cc`, la corrección de captura (025) y la Ley de
      Ingresos GT (026)**. Hecho el 5 de octubre de 2026: producción en
      `bea099e`, migración 026, 82/82 pruebas en el servidor, respaldo previo.
- [ ] **Cerrar la puerta de la corrección de captura** cuando termine el año de
      captura en paralelo (por ejemplo, solo en meses sin corte, o solo el
      primer ejercicio). Hoy está abierta a propósito, nivel V∴M∴.
- [ ] **Comentarios de Arturo sobre las pestañas**: se atendieron el 6 (egresos)
      y el 7 (Gran Tesorería). Seguir con los que siguen.
- [ ] (Backlog) **Corregir periodos de una obligación GT desde su ficha** (solo
      periodos, nunca montos, con motivo): hoy esa corrección requirió
      intervención por servidor y el guardián de la base ya la permite.
- [x] **Desplegar la tesorería** en https://tesoreria.masada324.org. Hecho el
      24 de agosto de 2026. El procedimiento y lo que el despliegue real destapó
      están en `tesoreria/README.md`, sección "Despliegue"; la operación del
      servidor, en `serverAdmin/tesoreria-masada-despliegue.md`.
- [ ] **Copia externa de los respaldos** de la tesorería: hoy el respaldo diario
      vive solo en el VPS. Falta decidir el destino (otro servidor, S3, Drive) y
      montarlo; hasta entonces, perder el disco es perder también los respaldos.
- [ ] **Confirmar que el repo público es deliberado**: `marturojt/masada` es
      público y no contiene secretos, pero el código y el modelo de datos de la
      tesorería son legibles por cualquiera.
- [ ] **Desplegar el sitio** para que la tenida de junio deje de aparecer como
      próxima: `bash deploy/publish.sh`.
- [ ] **Módulo de control interno de grados** (a futuro): captura formal de las
      fechas de iniciación, aumento de salario y exaltación de cada hermano, solo
      para control interno. Hoy el historial de grados ya existe en la ficha del
      hermano y esas fechas entran por ahí o por la carga masiva; el módulo nuevo
      les daría su propia pantalla de administración.
- [ ] **Histórico completo de Past Masters**: hoy están 2022 a 2025 en
      `past_master_historico`. El usuario pasará el resto de la historia de la logia.
- [ ] (Opcional) Limpiar el código inerte de la insignia "Vigente" en la sección
      Past Masters de `cuadro-logial.astro`: el campo `vigente` ya no se usa, un
      past master nunca está vigente.

---

## Notas de contexto

- **Preferencia de redacción:** sin guiones largos (—), usar comas. Aplica también a
  los mensajes de error del sistema: los lee el tesorero.
- **Dato del cuadro:** Mario Arturo Jiménez Terrón es el **V∴M∴ vigente 2026**; por
  eso NO está en Past Masters.
- **Imágenes del sitio:** flyers de eventos en `public/images/eventos/`, 4:5.
- **Comprobantes de la tesorería:** viven en `tesoreria/comprobantes/`, fuera del
  sitio, y no se versionan. Van en el mismo respaldo que la base.
- `node_modules` no se versiona en ninguno de los dos proyectos: correr
  `npm install` en la raíz y en `tesoreria/` tras clonar.
