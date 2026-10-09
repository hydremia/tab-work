/**
 * The unit's static pressure profile as a diagram on the unit page: the cabinet in the unit's own component order
 * (unit configuration library, else the template's), a tap at each place a reading is taken with the reading when
 * there is one, and the pressure change between readings. An empty tap shows where to take the reading; tapping a tap
 * moves to its field. Same layout as the graphics appendix (domain/unitDiagram.ts).
 */
import type { Equipment, FieldValue, LibraryUnit } from '../../data/types';
import { staticInputs, type XCell } from '../../domain/staticProfile';
import { unitDiagram, type DiagramKind, type UnitDiagram as Diagram } from '../../domain/unitDiagram';
import { matchLibraryUnit } from '../../domain/unitLibrary';

const STATIC_KEYS = ['unitType', 'spEntering', 'spLeaving1', 'spLeaving2', 'spLeaving3', 'spLeaving4', 'spLeaving5'];

/** The unit's diagram from its fields (a field marked N/A carries its notation, as the workbook prints it). */
export function diagramFor(equipment: Equipment, library: readonly LibraryUnit[] | undefined): Diagram {
  const cells: Record<string, XCell> = {};
  for (const k of STATIC_KEYS) {
    const mark = equipment.naState.fields[k];
    cells[k] = mark ? mark.notation : (equipment.data[k] as FieldValue | undefined);
  }
  const m = matchLibraryUnit(library, equipment.data.manufacturer, equipment.data.model);
  return unitDiagram(staticInputs(cells), m?.components, { noFilters: equipment.data.hasFilters === 'No' });
}

/** Where a reading field's tap is on this unit, when the strip's name for it says otherwise ("fan inlet"). */
export function tapHint(d: Diagram, field: string): string | null {
  const t = d.taps.find((x) => x.field === field);
  if (!t || t.slot < 0 || t.inDuct || t.name === t.entered) return null;
  return t.name === 'Fan inlet' ? 'at the fan inlet on this unit' : null;
}

const W = 640;
const CAB_X = 34;
const DUCT_W = 50;
const CAB_W = W - CAB_X - DUCT_W - 26;
const CAB_TOP = 52;
const CAB_H = 64;

const fmt = (v: XCell) => (typeof v === 'number' ? v.toFixed(2) : v === null || v === undefined ? '' : String(v));

function Glyph({ kind, name, x, w }: { kind: DiagramKind; name: string; x: number; w: number }) {
  const y = CAB_TOP;
  const h = CAB_H;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cool = 'var(--blue-solid)';
  const warm = 'var(--amber-solid)';
  const pleats = (n: number) => {
    const px = x + w * 0.32;
    const pw = w * 0.36;
    const d = Array.from({ length: n + 1 }, (_, i) => `${i % 2 ? px + pw : px},${y + 7 + ((h - 14) * i) / n}`).join(
      ' ',
    );
    return <polyline points={d} fill="none" stroke={cool} strokeWidth={1.1} />;
  };
  const coil = (color: string) => (
    <g stroke={color} strokeWidth={0.9} fill="var(--surface)">
      {Array.from({ length: 6 }, (_, i) => {
        const lx = x + w * 0.27 + i * w * 0.093;
        return <line key={i} x1={lx} x2={lx} y1={y + 6} y2={y + h - 6} />;
      })}
      {Array.from({ length: 4 }, (_, j) => (
        <circle key={j} cx={cx} cy={y + 11 + (j * (h - 22)) / 3} r={2.6} />
      ))}
    </g>
  );
  switch (kind) {
    case 'inlet':
    case 'damper':
      return (
        <g stroke="var(--text-3)" strokeWidth={1.4}>
          {Array.from({ length: 5 }, (_, i) => {
            const ly = y + 9 + (i * (h - 18)) / 4;
            return <line key={i} x1={x + w * 0.3} x2={x + w * 0.7} y1={ly + 4} y2={ly - 4} />;
          })}
        </g>
      );
    case 'filter':
      return pleats(7);
    case 'finalFilter':
      return pleats(9);
    case 'coil':
      return coil(cool);
    case 'reheat':
      return coil(warm);
    case 'wheel':
    case 'desiccant': {
      if (name.toLowerCase().startsWith('core'))
        return (
          <g stroke={cool} fill="var(--blue-bg)">
            <polygon points={`${cx},${y + 6} ${x + w * 0.8},${cy} ${cx},${y + h - 6} ${x + w * 0.2},${cy}`} />
          </g>
        );
      const rx = w * 0.15;
      const ry = h * 0.4;
      const tone = kind === 'desiccant' ? 'var(--amber)' : cool;
      return (
        <g stroke={tone} strokeWidth={0.9}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={kind === 'desiccant' ? 'var(--amber-bg)' : 'var(--blue-bg)'} />
          {kind === 'desiccant' &&
            Array.from({ length: 5 }, (_, i) => {
              const yy = cy - ry + (2 * ry * (i + 1)) / 6;
              const half = rx * Math.sqrt(1 - ((yy - cy) / ry) ** 2);
              return <line key={i} x1={cx - half} x2={cx + half} y1={yy} y2={yy} strokeWidth={0.5} />;
            })}
          <line x1={cx} x2={cx} y1={cy - ry} y2={cy + ry} strokeWidth={0.6} />
        </g>
      );
    }
    case 'burner':
      return (
        <g fill="#f7b25a" stroke="#c4621a" strokeWidth={0.7}>
          {[0.3, 0.5, 0.7].map((t) => {
            const fx = x + w * t;
            const fy = y + h - 9;
            return (
              <path
                key={t}
                d={`M ${fx - 5} ${fy} Q ${fx - 6} ${fy - 13} ${fx} ${fy - 24} Q ${fx + 6} ${fy - 13} ${fx + 5} ${fy} Z`}
              />
            );
          })}
        </g>
      );
    case 'heat':
      return (
        <g stroke={warm} strokeWidth={1.4} fill="none">
          {[0, 1, 2].map((j) => {
            const ty = y + 13 + (j * (h - 26)) / 2;
            return (
              <path
                key={j}
                d={`M ${x + w * 0.22} ${ty} Q ${x + w * 0.36} ${ty - 6} ${x + w * 0.5} ${ty} T ${x + w * 0.78} ${ty}`}
              />
            );
          })}
        </g>
      );
    case 'fan': {
      const r = Math.min(w, h) * 0.34;
      return (
        <g stroke={cool} strokeWidth={1.3} fill="none">
          <circle cx={cx} cy={cy} r={r + 3} />
          <circle cx={cx} cy={cy} r={r * 0.3} fill={cool} />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            return (
              <line
                key={i}
                x1={cx + Math.cos(a) * r * 0.35}
                y1={cy + Math.sin(a) * r * 0.35}
                x2={cx + Math.cos(a + 0.5) * r}
                y2={cy + Math.sin(a + 0.5) * r}
              />
            );
          })}
        </g>
      );
    }
    default:
      return (
        <rect x={x + w * 0.25} y={y + h * 0.25} width={w * 0.5} height={h * 0.5} fill="none" stroke="var(--text-3)" />
      );
  }
}

export function UnitDiagram({ equipment, diagram }: { equipment: Equipment; diagram: Diagram }) {
  const d = diagram;
  const n = d.sections.length;
  const secW = CAB_W / n;
  const dx = CAB_X + CAB_W;
  const tapX = (t: Diagram['taps'][number]) => (t.inDuct ? dx + DUCT_W / 2 : CAB_X + (t.station + 1) * secW);
  const anyOptional = d.sections.some((s) => s.optional);
  const spanY = CAB_TOP + CAB_H + (anyOptional ? 40 : 32);
  const H = spanY + (d.spans.length ? 22 : 4);
  // the library panel under the drawing already compares the order with the template's
  const notes = d.notes.filter((n) => !n.startsWith('The workbook strip lists'));
  const focus = (field: string) => {
    const el = document.getElementById(`${equipment.id.slice(0, 8)}-${field}`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // callout boxes, kept apart left to right
  const callouts: { t: Diagram['taps'][number]; x: number; bx: number; bw: number; label: string; value: string }[] =
    [];
  for (const t of d.taps) {
    const x = tapX(t);
    const label = t.name.replace(/ leaving$/, ' lvg').toLowerCase();
    const value = fmt(t.value);
    const bw = Math.max(label.length * 4.9, (value || '—').length * 7.4) + 12;
    const prev = callouts.at(-1);
    const bx = Math.min(Math.max(x - bw / 2, prev ? prev.bx + prev.bw + 3 : -Infinity), W - bw - 2);
    callouts.push({ t, x, bx, bw, label, value });
  }
  return (
    <figure className="unit-diagram" style={{ margin: 0 }} data-testid="unit-diagram">
      {/* on a phone the drawing keeps a readable size and scrolls sideways */}
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Static pressure taps on ${equipment.designation}: ${d.taps
            .map((t) => `${t.name} ${fmt(t.value) || 'not read'}`)
            .join(', ')}`}
          style={{ display: 'block', minWidth: 560, maxWidth: 760, fontFamily: 'var(--font)' }}
        >
          <defs>
            <marker id="ud-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--text-3)" />
            </marker>
          </defs>
          {/* airflow in and out */}
          <line
            x1={4}
            x2={CAB_X - 4}
            y1={CAB_TOP + CAB_H / 2}
            y2={CAB_TOP + CAB_H / 2}
            stroke="var(--text-3)"
            strokeWidth={1.4}
            markerEnd="url(#ud-arrow)"
          />
          <line
            x1={dx + DUCT_W + 3}
            x2={W - 4}
            y1={CAB_TOP + CAB_H / 2}
            y2={CAB_TOP + CAB_H / 2}
            stroke="var(--text-3)"
            strokeWidth={1.4}
            markerEnd="url(#ud-arrow)"
          />
          <rect
            x={CAB_X}
            y={CAB_TOP}
            width={CAB_W}
            height={CAB_H}
            rx={3}
            fill="var(--surface-2)"
            stroke="var(--text)"
            strokeWidth={1.6}
          />
          <rect
            x={dx}
            y={CAB_TOP + CAB_H * 0.25}
            width={DUCT_W}
            height={CAB_H * 0.5}
            fill="var(--surface-2)"
            stroke="var(--text)"
            strokeWidth={1.2}
          />
          <text
            x={dx + DUCT_W / 2}
            y={CAB_TOP + CAB_H * 0.75 + 12}
            fontSize={9}
            textAnchor="middle"
            fill="var(--text-3)"
          >
            supply
          </text>
          {d.sections.map((s, i) => {
            const x = CAB_X + i * secW;
            return (
              <g key={i}>
                {i > 0 && <line x1={x} x2={x} y1={CAB_TOP} y2={CAB_TOP + CAB_H} stroke="var(--border-strong)" />}
                {s.optional && (
                  <rect
                    x={x + 3}
                    y={CAB_TOP + 3}
                    width={secW - 6}
                    height={CAB_H - 6}
                    fill="none"
                    stroke="var(--text-3)"
                    strokeDasharray="3 3"
                  />
                )}
                <Glyph kind={s.kind} name={s.name} x={x} w={secW} />
                <text
                  x={x + secW / 2}
                  y={CAB_TOP + CAB_H + 14}
                  fontSize={secW < 80 ? 9.5 : 11}
                  fontWeight={600}
                  textAnchor="middle"
                  fill="var(--text)"
                >
                  {s.name}
                  {s.detail && <title>{s.detail}</title>}
                </text>
                {s.optional && (
                  <text x={x + secW / 2} y={CAB_TOP + CAB_H + 26} fontSize={9} textAnchor="middle" fill="var(--text-3)">
                    (option)
                  </text>
                )}
              </g>
            );
          })}
          {/* pressure change between readings */}
          {d.spans.map((sp, i) => {
            const x0 = tapX(d.taps[sp.from]);
            const x1 = tapX(d.taps[sp.to]);
            const v = `${sp.fan ? 'rise' : 'Δ'} ${sp.dp >= 0 ? '+' : ''}${sp.dp.toFixed(2)}`;
            return (
              <g key={i} fill="var(--text-2)" stroke="var(--text-3)">
                <path d={`M ${x0 + 4} ${spanY - 9} V ${spanY - 5} H ${x1 - 4} V ${spanY - 9}`} fill="none" />
                <text x={(x0 + x1) / 2} y={spanY + 8} fontSize={10} textAnchor="middle" stroke="none">
                  {v}
                </text>
              </g>
            );
          })}
          {/* taps */}
          {callouts.map(({ t, x, bx, bw, label, value }) => {
            const read = value !== '';
            const tapY = t.inDuct ? CAB_TOP + CAB_H * 0.25 : CAB_TOP;
            const boxY = 6;
            const tone = read ? 'var(--red-solid)' : 'var(--text-3)';
            return (
              <g
                key={t.field}
                onClick={() => focus(t.field)}
                style={{ cursor: 'pointer' }}
                data-testid={`tap-${t.field}`}
              >
                <title>
                  {`${t.name}: ${value || 'not read yet'} (entered as "${t.entered}")${t.note ? `; ${t.note}` : ''}`}
                </title>
                <line x1={x} x2={x} y1={boxY + 30} y2={tapY} stroke={tone} strokeDasharray={read ? undefined : '3 2'} />
                {Math.abs(bx + bw / 2 - x) > 2 && (
                  <line x1={x} x2={bx + bw / 2} y1={boxY + 30} y2={boxY + 30} stroke={tone} />
                )}
                <circle
                  cx={x}
                  cy={tapY}
                  r={3.6}
                  fill={read ? tone : 'var(--surface)'}
                  stroke={tone}
                  strokeWidth={1.4}
                />
                <rect
                  x={bx}
                  y={boxY}
                  width={bw}
                  height={30}
                  rx={5}
                  fill={read ? 'var(--surface)' : 'var(--surface-2)'}
                  stroke={tone}
                  strokeDasharray={read ? undefined : '3 2'}
                />
                <text x={bx + bw / 2} y={boxY + 11} fontSize={8.5} textAnchor="middle" fill={tone}>
                  {label}
                </text>
                <text
                  x={bx + bw / 2}
                  y={boxY + 25}
                  fontSize={12}
                  fontWeight={700}
                  textAnchor="middle"
                  fill={read ? 'var(--text)' : 'var(--text-3)'}
                >
                  {value || '—'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {notes.length > 0 && (
        <figcaption className="small" style={{ color: 'var(--amber)' }} data-testid="unit-diagram-notes">
          {notes.join(' ')}
        </figcaption>
      )}
    </figure>
  );
}
