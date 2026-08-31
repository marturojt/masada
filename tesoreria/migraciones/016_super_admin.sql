-- 016_super_admin.sql
--
-- Rol super_admin: mismo nivel de autoridad que el Venerable Maestro. Existe
-- para que la operación de la plataforma (usuarios, contraseñas) no dependa de
-- quién ocupe el cargo de V∴M∴ cada año. En las firmas de egresos cubre el
-- lugar del V∴M∴ sin ser suplencia (es su mismo nivel), y puede suplir al
-- tesorero igual que el V∴M∴, dejando constancia del motivo.

alter table usuario drop constraint usuario_rol_check;
alter table usuario add constraint usuario_rol_check
  check (rol in ('tesorero', 'venerable_maestro', 'super_admin'));

comment on column usuario.rol is
  'tesorero opera la caja; venerable_maestro autoriza; super_admin tiene el '
  'mismo nivel que el venerable_maestro y además administra los usuarios.';

alter table egreso_firma drop constraint egreso_firma_rol_firmante_check;
alter table egreso_firma add constraint egreso_firma_rol_firmante_check
  check (rol_firmante in ('tesorero', 'venerable_maestro', 'super_admin'));

-- La coherencia de la firma, ahora con nivel: la firma directa es la del rol
-- requerido o la del super_admin cubriendo el lugar del V∴M∴; la suplencia
-- sigue siendo solo sobre la firma del tesorero, por alguien de nivel V∴M∴,
-- y siempre con motivo.
alter table egreso_firma drop constraint firma_suplencia_coherente;
alter table egreso_firma drop constraint solo_vm_suple;

alter table egreso_firma add constraint firma_suplencia_coherente check (
  (
    not es_suplencia
    and motivo_suplencia is null
    and (
      rol_firmante = rol_requerido
      or (rol_requerido = 'venerable_maestro' and rol_firmante = 'super_admin')
    )
  )
  or (
    es_suplencia
    and motivo_suplencia is not null
    and rol_requerido = 'tesorero'
    and rol_firmante in ('venerable_maestro', 'super_admin')
  )
);

comment on constraint firma_suplencia_coherente on egreso_firma is
  'Firma directa: el rol requerido, o super_admin en el lugar del V∴M∴ (mismo '
  'nivel, no es suplencia). Suplencia: solo la firma del tesorero, por alguien '
  'de nivel V∴M∴, con motivo. El tesorero no puede firmar por el V∴M∴.';
