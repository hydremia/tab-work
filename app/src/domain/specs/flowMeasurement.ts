/** Ultrasonic flow readings (hydronic workbook, Flow Measurements sheet): NEBB 5.3.17, one reading per row. */
import type { EquipmentSpec } from './types';

export const FLOW_MEASUREMENT_SPEC: EquipmentSpec = {
  type: 'flowMeasurement',
  totalCheck: { calc: 'flow', label: 'Measured flow' },
  sections: [
    {
      key: 'identity',
      label: 'Reading',
      airflow: true,
      locked: true,
      fields: [
        { key: 'designation', label: 'No.', input: 'text', recordField: 'designation' },
        { key: 'system', label: 'System served', input: 'text' },
        { key: 'location', label: 'Measurement location', input: 'text' },
      ],
    },
    {
      key: 'pipe',
      label: 'Pipe and transducers',
      airflow: true,
      fields: [
        { key: 'pipeSize', label: 'Pipe size', input: 'text' },
        {
          key: 'pipeMaterial',
          label: 'Pipe material',
          input: 'text',
          suggestions: ['Steel', 'Copper', 'PVC', 'CPVC', 'Ductile iron'],
        },
        { key: 'wallThickness', label: 'Wall thickness', input: 'number', unit: 'in.' },
        { key: 'transducer', label: 'Transducer size / type', input: 'text' },
        { key: 'configuration', label: 'Configuration', input: 'text', suggestions: ['V', 'W', 'Z'] },
        { key: 'spacing', label: 'Spacing distance', input: 'text' },
      ],
    },
    {
      key: 'flow',
      label: 'Flow',
      airflow: true,
      fields: [
        { key: 'designGpm', label: 'Design flow', input: 'number', unit: 'GPM' },
        { key: 'measuredGpm', label: 'Measured flow', input: 'number', unit: 'GPM' },
        { key: 'notes', label: 'Notes', input: 'text', required: false },
      ],
    },
  ],
};
