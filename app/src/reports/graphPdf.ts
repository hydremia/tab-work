/**
 * A workbook's PDF through Microsoft Graph: the file goes to the signed-in user's OneDrive, into the app's own folder
 * (permission Files.ReadWrite.AppFolder: the app sees nothing else in the drive), Graph converts it with Excel's own
 * engine (`format=pdf`: page breaks, fit to page, print areas, headers and footers as Excel prints them), the PDF
 * comes back and the temporary file is deleted, whatever happened. Nothing stays in OneDrive: the team keeps its
 * reports in Dropbox. Works from any device with a browser; the token comes from auth/graph.ts.
 */
import { XLSX_MIME } from './pdfWorkbook';

export const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH = `${GRAPH_ORIGIN}/v1.0`;
/** Above this a resumable upload session is used (the simple upload takes up to 250 MB today, 4 MB historically). */
export const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
/** Upload-session chunk: a multiple of 320 KiB, as Graph requires. */
export const UPLOAD_CHUNK = 16 * 320 * 1024;

export type GraphStep = 'upload' | 'convert' | 'delete';

export interface GraphPdfOptions {
  fetch?: typeof fetch;
  onStep?: (step: GraphStep) => void;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

async function graphError(res: Response, what: string): Promise<GraphError> {
  let code: string | undefined;
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = j.error?.code;
    detail = j.error?.message ?? '';
  } catch {
    /* no JSON body */
  }
  const why =
    res.status === 401 || res.status === 403
      ? 'Microsoft 365 did not accept the connection: connect again.'
      : res.status === 507 || code === 'quotaLimitReached'
        ? 'The OneDrive is full.'
        : detail || res.statusText || `HTTP ${res.status}`;
  return new GraphError(`${what}: ${why}`, res.status, code);
}

/**
 * Uploads `bytes` as `fileName` to the app folder, converts it to PDF and deletes it. `fileName` should end in .xlsx
 * (Graph converts by extension); an existing file of that name is replaced.
 */
export async function workbookToPdf(
  bytes: Uint8Array,
  fileName: string,
  token: string,
  opts: GraphPdfOptions = {},
): Promise<Uint8Array> {
  const f = opts.fetch ?? fetch;
  const auth = { Authorization: `Bearer ${token}` };
  const name = encodeURIComponent(fileName);

  opts.onStep?.('upload');
  let itemId: string;
  if (bytes.length <= SIMPLE_UPLOAD_MAX) {
    const res = await f(
      `${GRAPH}/me/drive/special/approot:/${name}:/content?@microsoft.graph.conflictBehavior=replace`,
      { method: 'PUT', headers: { ...auth, 'Content-Type': XLSX_MIME }, body: bytes as BodyInit },
    );
    if (!res.ok) throw await graphError(res, 'Upload to OneDrive failed');
    itemId = ((await res.json()) as { id: string }).id;
  } else {
    const start = await f(`${GRAPH}/me/drive/special/approot:/${name}:/createUploadSession`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name: fileName } }),
    });
    if (!start.ok) throw await graphError(start, 'Upload to OneDrive failed');
    const { uploadUrl } = (await start.json()) as { uploadUrl: string };
    let item: { id: string } | null = null;
    for (let at = 0; at < bytes.length; at += UPLOAD_CHUNK) {
      const end = Math.min(at + UPLOAD_CHUNK, bytes.length);
      // the upload URL is pre-authenticated: no Authorization header
      const res = await f(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${at}-${end - 1}/${bytes.length}`, 'Content-Length': String(end - at) },
        body: bytes.subarray(at, end) as BodyInit,
      });
      if (!res.ok) throw await graphError(res, 'Upload to OneDrive failed');
      if (res.status === 200 || res.status === 201) item = (await res.json()) as { id: string };
    }
    if (!item) throw new GraphError('Upload to OneDrive failed: the upload did not finish.', 0);
    itemId = item.id;
  }

  try {
    opts.onStep?.('convert');
    // a 302 to a short-lived download URL, which fetch follows (CORS is open on it)
    const res = await f(`${GRAPH}/me/drive/items/${itemId}/content?format=pdf`, { headers: auth });
    if (!res.ok) throw await graphError(res, 'PDF conversion failed');
    const pdf = new Uint8Array(await res.arrayBuffer());
    if (pdf.length < 5 || String.fromCharCode(...pdf.subarray(0, 5)) !== '%PDF-')
      throw new GraphError('PDF conversion failed: Microsoft 365 did not return a PDF.', res.status);
    return pdf;
  } finally {
    opts.onStep?.('delete');
    await f(`${GRAPH}/me/drive/items/${itemId}`, { method: 'DELETE', headers: auth }).then(
      (r) => {
        if (!r.ok && r.status !== 404)
          console.warn(`OneDrive: temporary file ${fileName} not deleted (HTTP ${r.status})`);
      },
      (e: unknown) => console.warn(`OneDrive: temporary file ${fileName} not deleted`, e),
    );
  }
}
