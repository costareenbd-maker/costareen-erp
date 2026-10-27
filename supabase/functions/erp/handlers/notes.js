// Notes and files on a record (plan D5, 038_record_notes.sql).
//
//   erpNotes({kind, ref})                         what has been written about it, newest first
//   erpNoteAdd({kind, ref, body, file})           a note, a file, or both
//   erpNoteVoid({id, reason})                     strike one out (manager and up) - it stays readable
//   erpNoteFileUrl({id})                          a link to the attached file
//
// kind: product (ref = product code) | customer (ref = customer key) |
//       supplier (ref = name) | invoice (ref = invoice number).
// Suppliers are a manager matter, so their notes are too.

import { formatDate } from '../lib/time.js';
import { saveFile, fileUrl } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { who } from './money.js';

const str = (v) => String(v == null ? '' : v).trim();
const KINDS = { product: 'sales', customer: 'sales', invoice: 'sales', supplier: 'manager' };
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

function target(ctx, payload) {
  const kind = str(payload && payload.kind), ref = str(payload && payload.ref).slice(0, 200);
  if (!KINDS[kind]) throw new Error('Notes are kept on a product, a customer, a supplier or an invoice.');
  if (!ref) throw new Error('Which one?');
  if (!roleAtLeast(ctx.s.role, KINDS[kind])) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).');
  return { kind, ref };
}

export async function erpNotes(ctx, payload) {
  const t = target(ctx, payload);
  const rows = await ctx.tx`select id, body, file, file_name, by, at, voided from record_notes
                            where business_id = ${ctx.biz} and kind = ${t.kind} and lower(ref) = ${t.ref.toLowerCase()}
                            order by at desc limit 200`;
  return { kind: t.kind, ref: t.ref, canVoid: roleAtLeast(ctx.s.role, 'manager'),
           notes: rows.map((r) => ({ id: r.id, when: formatDate(new Date(r.at), 'd MMM yyyy, h:mm a'), by: str(r.by), body: str(r.body),
                                     file: str(r.file) ? (str(r.file_name) || 'Attached file') : '', voided: str(r.voided) })) };
}

export async function erpNoteAdd(ctx, payload) {
  const t = target(ctx, payload);
  const body = str(payload.body).slice(0, 2000);
  const f = payload.file && payload.file.data ? payload.file : null;
  if (!body && !f) throw new Error('Write a note or attach a file.');
  let name = null, shown = null, mime = null;
  if (f) {
    mime = str(f.mime);
    const ext = FILE_TYPES[mime];
    if (!ext) throw new Error('A file here is a photo (JPG, PNG, WebP) or a PDF.');
    let bytes;
    try {
      const bin = atob(String(f.data || ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_) { throw new Error('That file could not be read. Try again.'); }
    if (!bytes.length) throw new Error('That file is empty.');
    if (bytes.length > 3 * 1024 * 1024) throw new Error('That file is over 3 MB. Use a smaller one.');
    name = t.kind + '-' + Date.now() + '-' + Math.floor(Math.random() * 900 + 100) + '.' + ext;
    shown = str(f.name).replace(/[\\/]/g, ' ').slice(0, 120) || ('file.' + ext);
    await saveFile(ctx, 'notes', name, bytes, mime);
  }
  await ctx.tx`insert into record_notes (business_id, kind, ref, body, file, file_name, file_mime, by)
               values (${ctx.biz}, ${t.kind}, ${t.ref}, ${body}, ${name}, ${shown}, ${mime}, ${who(ctx)})`;
  return erpNotes(ctx, t);
}

export async function erpNoteVoid(ctx, payload) {
  const id = str(payload && payload.id), why = str(payload && payload.reason).slice(0, 300);
  if (!isId(id)) throw new Error('Which note?');
  if (!why) throw new Error('Say why it is being struck out.');
  const mark = 'struck out ' + formatDate(new Date(), 'd MMM yy') + ' by ' + who(ctx) + ': ' + why;
  const r = await ctx.tx`update record_notes set voided = ${mark} where id = ${id} and business_id = ${ctx.biz} and voided is null returning kind, ref`;
  if (!r.length) throw new Error('That note was not found, or is already struck out.');
  return erpNotes(ctx, { kind: r[0].kind, ref: r[0].ref });
}

export async function erpNoteFileUrl(ctx, payload) {
  const id = str(payload && payload.id);
  const r = isId(id) ? (await ctx.tx`select kind, file from record_notes where id = ${id} and business_id = ${ctx.biz}`)[0] : null;
  if (!r || !str(r.file)) throw new Error('No file is kept with that note.');
  if (!roleAtLeast(ctx.s.role, KINDS[str(r.kind)] || 'owner')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).');
  return { url: await fileUrl(ctx, 'notes', str(r.file)) };
}

export const HANDLERS = { erpNotes, erpNoteAdd, erpNoteVoid, erpNoteFileUrl };
