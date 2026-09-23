"""Cross-block formula consistency scan.  python3 tools/verify_blocks.py <workbook.xlsm>"""
import sys
# Formula "shape" = formula with every A1 ref replaced by a placeholder; shapes must match across blocks.
# For each ref position, the referenced row across blocks should follow a regular progression:
#   delta(block i -> i+1) should be constant, OR alternate with period 2 (two blocks per page).
# Report any block whose delta breaks the pattern, and any shape mismatch.
from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string, get_column_letter
import re
from collections import defaultdict, Counter
wb = load_workbook(sys.argv[1], keep_vba=True)
ref_re = re.compile(r"((?:'[^']+'|[A-Za-z_{}][\w{} .()-]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)")
def parse(f):
    shape = ref_re.sub(lambda m: (m.group(1) or "")+"{"+m.group(3)+"}", f)
    refs=[(m.group(1) or "", m.group(3), int(m.group(5))) for m in ref_re.finditer(f)]
    return shape, refs
report=[]
for ws in wb.worksheets:
    anchors=[c.row for c in ws['B'] if c.value=='System']
    if len(anchors)<3: continue
    grid=defaultdict(dict)   # key -> block idx -> (shape, refs, coord)
    for bi,a in enumerate(anchors):
        end = anchors[bi+1] if bi+1<len(anchors) else ws.max_row+1
        for row in ws.iter_rows(min_row=a, max_row=end-1):
            for cell in row:
                v=cell.value
                if isinstance(v,str) and v.startswith("="):
                    grid[(cell.row-a, cell.column)][bi]=(*parse(v), cell.coordinate, v)
    issues=[]
    for key,bl in sorted(grid.items()):
        if len(bl)<3: 
            # formula present in only a few blocks: report which
            if len(bl)<len(anchors)-0 and len(bl)<=2:
                issues.append(f"  only in blocks {[bl[b][2] for b in bl]} : {list(bl.values())[0][3][:90]}")
            continue
        shapes=Counter(s for s,_,_,_ in bl.values())
        main=shapes.most_common(1)[0][0]
        for b,(s,refs,coord,f) in bl.items():
            if s!=main:
                issues.append(f"  {coord}: shape differs: {f[:110]}")
        # refs progression, only for blocks with main shape
        bs=sorted(b for b in bl if bl[b][0]==main)
        nref=len(bl[bs[0]][1])
        for ri in range(nref):
            rows={b: bl[b][1][ri][2] for b in bs}
            # own-row relative refs: convert to offset from block anchor
            sheetname=bl[bs[0]][1][ri][0]
            seq=[(b, rows[b]-anchors[b] if sheetname=="" else rows[b]) for b in bs]
            deltas=[(seq[i+1][0], seq[i+1][1]-seq[i][1]) for i in range(len(seq)-1)]
            # expected delta per block gap: allow pattern constant or alternating
            dvals=[d for _,d in deltas]
            cnt=Counter(dvals)
            if len(cnt)==1: continue
            # alternating check
            even=Counter(dvals[0::2]); odd=Counter(dvals[1::2])
            expected=[(even.most_common(1)[0][0] if i%2==0 else odd.most_common(1)[0][0]) for i in range(len(dvals))]
            bad=[(deltas[i][0], dvals[i], expected[i]) for i in range(len(dvals)) if dvals[i]!=expected[i]]
            if bad:
                for b,d,e in bad[:4]:
                    coord=bl[b][2]; f=bl[b][3]
                    issues.append(f"  {coord}: ref#{ri+1} ({sheetname}{bl[b][1][ri][1]}{bl[b][1][ri][2]}) step {d} vs expected {e}: {f[:100]}")
    # also: cells with a value where other blocks have a formula
    print(f"\n=== {ws.title}: {len(anchors)} blocks, anchors {anchors[:4]}..{anchors[-1]}, {len(issues)} issues")
    for s in issues[:80]: print(s)
