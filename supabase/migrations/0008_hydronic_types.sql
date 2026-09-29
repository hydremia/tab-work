-- 0008: hydronic equipment types (the hydronic workbook H01, docs/HYDRONIC_REQUIREMENTS.md).
-- The app adds four equipment types: pump, valveSystem (one Valves page = one system; its valves are airflow_rows
-- with table_key 'valves'), plant (chillers, towers, boilers, heat exchangers) and flowMeasurement (ultrasonic
-- readings). Only the equipment.type check changes; every sync rule stays as it is. Re-runnable.
--
-- Apply BEFORE anyone adds a hydronic unit in the app: until then the server refuses those units, and a device's
-- pushes (batched in edit order) stop at the first one.
alter table public.equipment drop constraint if exists equipment_type_check;
alter table public.equipment add constraint equipment_type_check check (type in (
  'rtu', 'mau', 'erv', 'fan', 'smallFan', 'vav', 'hood', 'traverse',
  'pump', 'valveSystem', 'plant', 'flowMeasurement'
));
