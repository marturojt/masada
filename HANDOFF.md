# Handoff — R∴L∴S∴ Masada No. 324

Documento para retomar el trabajo. Última actualización: **21 de agosto de 2026**.

> Lee primero el `README.md` de la raíz para el sitio público y
> `tesoreria/README.md` para el sistema de tesorería. Este documento cubre el
> **estado actual** y lo **pendiente**.

---

## Estado actual

El repositorio tiene dos proyectos:

| Proyecto | Estado |
|---|---|
| Sitio público (raíz) | En producción, sin cambios de contenido desde el commit `2df2824` |
| Tesorería (`tesoreria/`) | Construida y probada, **solo en local**, sin desplegar |

### Sitio público

Producción coincide con el repositorio. Las únicas diferencias que aparecen al
comparar el build de hoy contra https://masada324.org son por la fecha: la tenida
interlogial del 15 de junio ya pasó, así que el sitio publicado todavía la muestra
como próxima y con el botón de confirmar asistencia. Un `bash deploy/publish.sh`
lo corrige, no hay cambios de contenido pendientes.

Páginas: home, cuadro logial, eventos (índice y detalle), noticias (índice, detalle
y por etiqueta), ingreso.

### Tesorería

Sistema interno de tesorería, con registro desde el ejercicio 2026.

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
- **Gran Tesorería**: dominio propio. Membresías capturadas como llegan y ligadas
  al padrón, tarifas GT sin retroactivo, obligaciones con lo que GT reporta (GT- y
  REG-), pago que nace de la obligación, viaja en un egreso con dos firmas y se
  materializa al entregar (GTP-), estado a plomo derivado y conciliación de los
  tres padrones (interno, Gran Secretaría, Gran Tesorería), que informa y no
  bloquea. Lo interno y lo de GT están desacoplados: nada se reserva solo.
- **Aportaciones**: la monetaria es ingreso normal con recibo; la de especie deja
  constancia imprimible (APO-) y jamás toca el libro de caja.
- **Registros externos por hermano**: en la ficha, lo que la Gran Secretaría y la
  Gran Tesorería saben de él, con su estatus y fechas.
- **Informe mensual ampliado**: el corte y su hoja imprimible traen resumen por
  clasificación, sección de Gran Tesorería y aportaciones en especie fuera de las
  cifras.
- **Dos bolsas**: cada movimiento indica banco o efectivo, hay traspasos entre
  bolsas (depósitos y retiros, con ficha) y los cortes muestran el saldo por bolsa.
- **Cortes mensuales**: saldos encadenados por bolsa, cierre en orden, bloqueo del
  mes en la base de datos, movimientos de ajuste, reapertura excepcional del V∴M∴
  con huella, y hoja imprimible.
- **Exportación** del cuadro logial al sitio público, con solo nombre, grado y cargo.

Verificado de punta a punta: 61 pruebas automatizadas en verde (`npm run prueba`)
y un recorrido completo por HTTP en una base aparte (obligación → egreso con dos
firmas → entrega → pago GT aplicado; aportaciones con recibo y constancia;
conciliación). El respaldo se probó restaurándolo en una base aparte.

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
6. **Renglones de membresía**: se capturan tal como GT los reporta y no se editan;
   lo único que cambia después es su liga con el padrón.

---

## Lo que falta para poder usarla

Todo esto lo hace el tesorero, no requiere código:

1. **Crear los dos usuarios**: `cd tesoreria && npm run sembrar`. Pide correo,
   nombre, rol y contraseña de cada uno, sin mostrarla. Mínimo 14 caracteres.
2. **Capturar el saldo de apertura de 2026** en Herramientas. De ahí se encadenan
   todos los saldos de los cortes.
3. **Completar el padrón**: los 12 hermanos ya están importados del cuadro
   publicado, con nombre, grado y cargo. Falta la fecha real de ingreso de cada uno
   (hoy quedaron como regularización al 31 de diciembre de 2025, que es lo correcto
   para quien ya estaba, pero hay que confirmarlo) y las fechas de iniciación.
4. **Asignar la modalidad de cápita** de cada hermano para 2026.
5. **Capturar lo que va del año**: ingresos, egresos y pagos a la Gran Tesorería,
   con sus comprobantes.
6. **Cerrar los meses** ya terminados, en orden.

### Datos que el sistema todavía no conoce

- Saldo de apertura de 2026.
- Montos de las cuotas de grado que el candidato paga a la logia (iniciación,
  aumento de salario, exaltación). Se capturan al registrar cada ingreso.
- Fechas de iniciación y afiliación de cada hermano.

---

## Pendientes de código

- [ ] **Desplegar la tesorería** en **https://tesoreria.masada324.org** (el
      subdominio ya existe). El procedimiento completo para el agente de despliegue
      está en `tesoreria/README.md`, sección "Despliegue": usuario de sistema,
      rol y base de PostgreSQL, `.env` de producción, unidad systemd, vhost de
      Apache con proxy a 127.0.0.1:4322 y respaldo diario. No se ha ejecutado
      nunca; lo que truene se corrige y se anota.
- [ ] **Desplegar el sitio** para que la tenida de junio deje de aparecer como
      próxima: `bash deploy/publish.sh`.
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
