-- 022_tope_ajustes.sql
--
-- Lo que enseñó el segundo caso real: dos ajustes de 4,250 sobre un ingreso de
-- 4,500 entraron sin queja, dejando un neto de -4,000 que nunca salió de la
-- caja. La validación miraba cada ajuste por separado; la regla correcta es
-- que LO ACUMULADO de los ajustes de un movimiento no pase de su monto: un
-- ajuste corrige, no puede voltear el signo de lo que corrige.

create or replace function fn_ajuste_no_excede() returns trigger
language plpgsql as $$
declare
  v_origen   movimiento;
  v_ajustado int;
  v_nuevo    int;
begin
  select * into v_origen from movimiento where id = new.movimiento_origen_id;

  select coalesce(sum(a.monto_centavos), 0) into v_ajustado
    from movimiento_ajuste ma
    join movimiento a on a.id = ma.movimiento_ajuste_id
   where ma.movimiento_origen_id = new.movimiento_origen_id
     and ma.movimiento_ajuste_id <> new.movimiento_ajuste_id;

  select monto_centavos into v_nuevo from movimiento where id = new.movimiento_ajuste_id;

  if v_ajustado + v_nuevo > v_origen.monto_centavos then
    raise exception
      'Los ajustes de este movimiento ya suman % y con este llegarían a %, más que el '
      'original de %. Un ajuste corrige el movimiento, no puede dejarlo en negativo',
      fn_pesos(v_ajustado), fn_pesos(v_ajustado + v_nuevo),
      fn_pesos(v_origen.monto_centavos);
  end if;

  return new;
end $$;

create trigger tr_ajuste_no_excede before insert or update on movimiento_ajuste
  for each row execute function fn_ajuste_no_excede();
