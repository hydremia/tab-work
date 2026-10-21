/**
 * Workbook order (template revision 09 queue, item 6: the hoods printed with H-1 last): a unit's slot among the units
 * of its type is its position on the unit sheets, the Equipment Summary and the Building Balance. Move up / down swaps
 * slots with the neighbour, as one synced change.
 */
import { swapSlots } from '../../data/repo';
import type { Equipment } from '../../data/types';
import { equipmentType } from '../../domain/equipmentTypes';

export function SlotOrder({ equipment, all, locked }: { equipment: Equipment; all: Equipment[]; locked: boolean }) {
  const info = equipmentType(equipment.type);
  const same = all.filter((e) => e.type === equipment.type).sort((a, b) => a.slot - b.slot);
  const i = same.findIndex((e) => e.id === equipment.id);
  const prev = i > 0 ? same[i - 1] : null;
  const next = i >= 0 && i < same.length - 1 ? same[i + 1] : null;
  return (
    <section className="card card-pad stack" aria-labelledby="slot-h" data-testid="slot-order">
      <h2 id="slot-h" style={{ margin: 0 }}>
        Workbook order
      </h2>
      <p className="small muted" style={{ margin: 0 }} data-testid="slot-order-text">
        {info.plural} slot <b>{equipment.slot}</b> of {info.capacity}:{' '}
        {same.length > 1 ? `${i + 1} of ${same.length}` : 'the only one'} on the {info.plural} sheets, the Equipment
        Summary and the Building Balance. Units print in slot order.
      </p>
      {same.length > 1 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={locked || !prev}
            data-testid="slot-up"
            title={prev ? `Swap slots with ${prev.designation || 'the unit above'}` : 'Already first'}
            onClick={() => prev && void swapSlots(equipment.id, prev.id)}
          >
            ↑ Move up{prev ? ` (before ${prev.designation})` : ''}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={locked || !next}
            data-testid="slot-down"
            title={next ? `Swap slots with ${next.designation || 'the unit below'}` : 'Already last'}
            onClick={() => next && void swapSlots(equipment.id, next.id)}
          >
            ↓ Move down{next ? ` (after ${next.designation})` : ''}
          </button>
        </div>
      )}
    </section>
  );
}
