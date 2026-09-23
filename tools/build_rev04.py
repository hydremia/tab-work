"""Revision 04 = revision 02 + 03 builders with the revision 04 options switched on:

  * static-pressure profile strip (unit schematic) on every RTU / MAU / ERV / fan page
  * quick-entry list for traverse readings
  * project photo box on the cover page

    python3 tools/build_rev04.py    # reads the newest 01 workbook, writes 04 - a2b_Blank_TAB_Workbook <date>.xlsm
"""
import datetime as dt
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
import build_rev02 as b2  # noqa: E402
import build_rev03 as b3  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = os.environ.get("TAB_BUILD_DATE", dt.date.today().strftime("%-m-%-d-%y"))
OUT = os.path.join(ROOT, f"04 - a2b_Blank_TAB_Workbook {STAMP}.xlsm")

if __name__ == "__main__":
    b2.OPTS["profile"] = True
    b3.OPTS["quick"] = True; b3.OPTS["cover"] = True
    tmp02 = tempfile.mktemp(suffix=".xlsm")
    print("[revision 02 builder, profile strip on]")
    b2.build(out=tmp02)
    print("[revision 03 builder, quick entry + cover photo on]")
    b3.build(out=OUT, src=tmp02)
    os.remove(tmp02)
    with open(os.path.join(ROOT, "docs", "build-log-rev04.txt"), "w") as fh:
        fh.write("\n".join(b2.LOG + b3.LOG) + "\n")
    print("written", OUT)
