// @vitest-environment node
import dictionary from 'dictionary-en';
import nspell from 'nspell';
import { describe, expect, it } from 'vitest';
import { sampleBundle } from '../test/fixtures';
import { checkSpelling, ignoredWords, withIgnored, wordsOf } from './spelling';

const spell = nspell({ aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic) });
const isWord = (w: string) => spell.correct(w);

describe('spelling over the printed text', () => {
  it('words: acronyms, tags, numbers and short words are skipped', () => {
    expect(wordsOf("RTU-1's VFD set to 60 Hz; 8x8 grilles, CFM ok. CaptiveAire's dessicant")).toEqual([
      'set',
      'grilles',
      'CaptiveAire',
      'dessicant',
    ]);
  });

  it('finds the Capitola typo in the narrative and a unit remark, with where to fix it; trade words pass', () => {
    const b = sampleBundle();
    b.project.info.narrative = 'The dessicant wheel was balanced with the balometer and a manometer.';
    b.equipment[0].data.remarks = 'Ductwork leaks at the plenum; the dessicant section is open.';
    const f = checkSpelling(b, isWord);
    expect(f.map((x) => x.word)).toContain('dessicant');
    const d = f.find((x) => x.word === 'dessicant')!;
    expect(d.places.map((p) => p.to)).toEqual(['info', `e/${b.equipment[0].id}#sec-remarks`]);
    expect(f.map((x) => x.word.toLowerCase())).not.toEqual(
      expect.arrayContaining(['balometer', 'manometer', 'ductwork', 'plenum']),
    );
    expect(spell.suggest('dessicant')).toContain('desiccant');
  });

  it("the project's ignored words are left out", () => {
    const b = sampleBundle();
    b.project.info.narrative = 'Served by the Westfeld kitchen.';
    expect(checkSpelling(b, isWord).map((x) => x.word)).toContain('Westfeld');
    b.project.info.spellIgnore = withIgnored(b.project.info, 'Westfeld');
    expect(ignoredWords(b.project.info).has('westfeld')).toBe(true);
    expect(checkSpelling(b, isWord).map((x) => x.word)).not.toContain('Westfeld');
  });
});
