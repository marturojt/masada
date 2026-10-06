-- 025_correccion_de_captura.sql
--
-- El primer año se captura en paralelo a los exceles, y la captura trae
-- errores: un beneficiario escrito de dos maneras, un concepto mal elegido,
-- una fecha que no es la real, una suplencia con un motivo que no aplica.
-- Esta migración abre la puerta para corregirlos sin reescribir el dinero.
--
-- 1. Un egreso en estado terminal (comprobado, rechazado, cancelado) sigue sin
--    admitir cambios de montos, nunca. El beneficiario y la descripción sí se
--    pueden corregir, pero solo cuando la transacción se declara corrección
--    de captura (tesoreria.correccion = 'on'), que es lo que hace el caso de
--    uso del V∴M∴. Una edición casual sigue chocando.
--
-- 2. El motivo de una suplencia se puede editar o limpiar. Firmar por el
--    tesorero sigue exigiendo motivo; limpiarlo después deja constancia de
--    quién y cuándo, y la bitácora guarda el texto anterior.

create or replace function fn_egreso_terminal() returns trigger
language plpgsql as $$
begin
  if old.estado in ('rechazado', 'cancelado', 'comprobado')
     and new.estado = old.estado
  then
    if (new.monto_solicitado_centavos, new.monto_autorizado_centavos,
        new.monto_entregado_centavos)
       is distinct from
       (old.monto_solicitado_centavos, old.monto_autorizado_centavos,
        old.monto_entregado_centavos)
    then
      raise exception
        'El egreso % está en estado "%" y sus montos ya no se editan. Corrige con un '
        'movimiento de ajuste', old.folio, old.estado;
    end if;

    if (new.beneficiario, new.descripcion) is distinct from (old.beneficiario, old.descripcion)
       and coalesce(current_setting('tesoreria.correccion', true), '') <> 'on'
    then
      raise exception
        'El egreso % está en estado "%" y ya no se edita. Los datos de captura se '
        'corrigen desde su ficha, como corrección de captura', old.folio, old.estado;
    end if;
  end if;
  return new;
end $$;

alter table egreso_firma add column motivo_limpiado_por bigint references usuario(id);
alter table egreso_firma add column motivo_limpiado_en timestamptz;

alter table egreso_firma drop constraint firma_suplencia_coherente;

alter table egreso_firma add constraint firma_suplencia_coherente check (
  (
    not es_suplencia
    and motivo_suplencia is null
    and motivo_limpiado_por is null
    and (
      rol_firmante = rol_requerido
      or (rol_requerido = 'venerable_maestro' and rol_firmante = 'super_admin')
    )
  )
  or (
    es_suplencia
    and (motivo_suplencia is not null or motivo_limpiado_por is not null)
    and rol_requerido = 'tesorero'
    and rol_firmante in ('venerable_maestro', 'super_admin')
  )
);

alter table egreso_firma add constraint firma_limpieza_completa check (
  (motivo_limpiado_por is null) = (motivo_limpiado_en is null)
);

comment on constraint firma_suplencia_coherente on egreso_firma is
  'Firma directa: el rol requerido, o super_admin en el lugar del V∴M∴ (mismo '
  'nivel, no es suplencia). Suplencia: solo la firma del tesorero, por alguien '
  'de nivel V∴M∴, con motivo, o con constancia de quién limpió el motivo.';

comment on column egreso_firma.motivo_limpiado_por is
  'Quién retiró el motivo de la suplencia como corrección de captura. La firma '
  'sigue siendo suplencia; el texto anterior queda en la bitácora.';
