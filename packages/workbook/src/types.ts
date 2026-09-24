/**
 * Project data as the app would hand it to the exporter (and as the importer returns it).
 * The shape mirrors the template map, so it is generic: section / unit keys and field keys
 * come from src/templateMap.ts.
 *
 *  - numbers are numbers; a notation ("N/A", "Not Avail.", "Not Acc.") may replace any number, date or list value;
 *  - dates are ISO strings "YYYY-MM-DD";
 *  - `null` explicitly clears a cell; a missing key leaves the template cell as it is.
 */
export type Value = number | string;
export type Cell = Value | null;

export interface LayoutData {
  fields?: Record<string, Cell>;
  tables?: Record<string, Array<Record<string, Cell>>>;
  lines?: Record<string, Array<string | null>>;
  sequences?: Record<string, Cell[]>;
  columnTables?: Record<string, Array<Record<string, Cell>>>;
}

export interface UnitData extends LayoutData {
  /** 1-based block number on the unit sheet (= row n of its {Equipment Data Entry} section). */
  slot: number;
  /** {Equipment Data Entry} row (design schedule). */
  schedule?: Record<string, Cell>;
}

export interface ProjectData {
  templateRevision: string;
  /** Not in the workbook: used for the output file name only. */
  name?: string;
  sections: Record<string, LayoutData>;
  equipment: Record<string, UnitData[]>;
  /** Not in the workbook as data: the cover picture, passed to the exporter as bytes. Path relative to the JSON. */
  coverPhoto?: string;
}
