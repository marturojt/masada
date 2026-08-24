-- 005_mensajes.sql
-- Los mensajes de error los lee el tesorero, no un programador: se muestran en
-- pesos y no en centavos. Se recrean las dos funciones de validación de cápitas
-- solo para eso.

create or replace function fn_pesos(p_centavos int) returns text
language sql immutable as $$
  select '$' || to_char(p_centavos::numeric / 100, 'FM999,999,990.00')
$$;

comment on function fn_pesos is
  'Formatea centavos como pesos para los mensajes de error de la base.';

create or replace function fn_validar_aplicacion() returns trigger
language plpgsql as $$
declare
  v_mov      bigint := coalesce(new.movimiento_id, old.movimiento_id);
  v_cargo    bigint := coalesce(new.capita_cargo_id, old.capita_cargo_id);
  v_aplicado int;
  v_tope     int;
begin
  if tg_op <> 'DELETE' then
    perform 1
      from movimiento m
      join concepto c on c.id = m.concepto_id
      join capita_cargo cc on cc.id = new.capita_cargo_id
     where m.id = new.movimiento_id
       and m.tipo = 'ingreso'
       and c.tipo_especial = 'capita'
       and cc.estado = 'vigente'
       and cc.hermano_id = m.hermano_id;
    if not found then
      raise exception
        'Aplicación inválida: el pago debe ser un ingreso de cápita del mismo hermano '
        'y el mes debe estar vigente';
    end if;
  end if;

  select coalesce(sum(monto_aplicado_centavos), 0) into v_aplicado
    from capita_aplicacion where movimiento_id = v_mov;
  select monto_centavos into v_tope from movimiento where id = v_mov;
  if v_aplicado > coalesce(v_tope, 0) then
    raise exception 'Se está aplicando % y el pago fue de %',
      fn_pesos(v_aplicado), fn_pesos(coalesce(v_tope, 0));
  end if;

  select coalesce(sum(monto_aplicado_centavos), 0) into v_aplicado
    from capita_aplicacion where capita_cargo_id = v_cargo;
  select cc.monto_esperado_centavos
           - coalesce((select sum(monto_centavos) from capita_condonacion co
                        where co.capita_cargo_id = cc.id), 0)
    into v_tope
    from capita_cargo cc where cc.id = v_cargo;
  if v_aplicado > coalesce(v_tope, 0) then
    raise exception 'Se está aplicando % a un mes al que solo le faltan %',
      fn_pesos(v_aplicado), fn_pesos(coalesce(v_tope, 0));
  end if;

  return null;
end $$;

create or replace function fn_validar_condonacion() returns trigger
language plpgsql as $$
declare v_falta int;
begin
  select cc.monto_esperado_centavos
           - coalesce((select sum(monto_aplicado_centavos) from capita_aplicacion ca
                        where ca.capita_cargo_id = cc.id), 0)
    into v_falta
    from capita_cargo cc where cc.id = new.capita_cargo_id;

  if v_falta is null then
    raise exception 'El mes que se quiere exentar no existe';
  end if;
  if new.monto_centavos > v_falta then
    raise exception 'La exención de % pasa de lo que falta en ese mes, que es %',
      fn_pesos(new.monto_centavos), fn_pesos(v_falta);
  end if;
  return new;
end $$;
