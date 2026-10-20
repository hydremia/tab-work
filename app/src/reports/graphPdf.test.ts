import { describe, expect, it } from 'vitest';
import { GraphError, SIMPLE_UPLOAD_MAX, UPLOAD_CHUNK, workbookToPdf } from './graphPdf';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

function fakeGraph(behaviour: { convert?: Response; upload?: Response } = {}) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body instanceof Uint8Array ? init.body : undefined;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    if (url.includes('/createUploadSession')) return Response.json({ uploadUrl: 'https://up.example.test/session' });
    if (url.startsWith('https://up.example.test/')) {
      const range = /bytes \d+-(\d+)\/(\d+)/.exec(headers['Content-Range'])!;
      return Number(range[1]) + 1 === Number(range[2])
        ? Response.json({ id: 'big1' }, { status: 201 })
        : Response.json({ nextExpectedRanges: [] }, { status: 202 });
    }
    if (url.includes(':/content') && init?.method === 'PUT') return behaviour.upload ?? Response.json({ id: 'item1' });
    if (url.includes('?format=pdf')) return behaviour.convert ?? new Response(PDF as BodyInit, { status: 200 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`unexpected ${url}`);
  };
  return { f, calls };
}

describe('workbook to PDF through Microsoft Graph', () => {
  it('uploads to the app folder, converts, returns the PDF and deletes the temporary file', async () => {
    const { f, calls } = fakeGraph();
    const pdf = await workbookToPdf(new Uint8Array([1, 2, 3]), 'TAB Report Final.xlsx', 'tok', { fetch: f });
    expect(pdf).toEqual(PDF);
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://graph.microsoft.com/v1.0', '')}`)).toEqual([
      'PUT /me/drive/special/approot:/TAB%20Report%20Final.xlsx:/content?@microsoft.graph.conflictBehavior=replace',
      'GET /me/drive/items/item1/content?format=pdf',
      'DELETE /me/drive/items/item1',
    ]);
    for (const c of calls) expect(c.headers.Authorization).toBe('Bearer tok');
    expect(calls[0].headers['Content-Type']).toContain('spreadsheetml.sheet');
  });

  it('a failed conversion still deletes the file and reports the message from Graph', async () => {
    const { f, calls } = fakeGraph({
      convert: Response.json({ error: { code: 'notSupported', message: 'Format not supported' } }, { status: 400 }),
    });
    await expect(workbookToPdf(new Uint8Array([1]), 'x.xlsx', 'tok', { fetch: f })).rejects.toThrow(
      'PDF conversion failed: Format not supported',
    );
    expect(calls.at(-1)?.method).toBe('DELETE');
  });

  it('an expired token reads as "connect again"', async () => {
    const { f } = fakeGraph({ upload: new Response(null, { status: 401 }) });
    const err = await workbookToPdf(new Uint8Array([1]), 'x.xlsx', 'old', { fetch: f }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect((err as GraphError).status).toBe(401);
    expect((err as Error).message).toContain('connect again');
  });

  it('a large workbook goes through an upload session in 320 KiB-multiple chunks without the bearer token', async () => {
    const { f, calls } = fakeGraph();
    const big = new Uint8Array(UPLOAD_CHUNK + 1000); // above the simple-upload limit, two chunks
    expect(big.length).toBeGreaterThan(SIMPLE_UPLOAD_MAX);
    const steps: string[] = [];
    await workbookToPdf(big, 'big.xlsx', 'tok', { fetch: f, onStep: (s) => steps.push(s) });
    const chunks = calls.filter((c) => c.url.startsWith('https://up.example.test/'));
    expect(chunks).toHaveLength(Math.ceil(big.length / UPLOAD_CHUNK));
    expect(chunks[0].headers['Content-Range']).toBe(`bytes 0-${UPLOAD_CHUNK - 1}/${big.length}`);
    expect(chunks.at(-1)!.headers['Content-Range']).toBe(`bytes ${UPLOAD_CHUNK}-${big.length - 1}/${big.length}`);
    expect(chunks.every((c) => !c.headers.Authorization)).toBe(true);
    expect(calls.filter((c) => c.url.includes('/items/big1')).map((c) => c.method)).toEqual(['GET', 'DELETE']);
    expect(steps).toEqual(['upload', 'convert', 'delete']);
  });
});
