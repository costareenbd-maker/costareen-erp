// ship-7 (owner 28 Nov 2026): our people who meet travellers and take the bags ("photo, name and phone, kept inside the
// system"), and the traveller's own page - a private link per shipment, no login (web/trip.html, ?inbox=trip&t=<token>).
//
//   erpShipTeam()                                  every team member (both airports)
//   erpShipTeamSave({id?, name, phone, role, port, photo?, active})   manager+
//   erpShipShare({id})                             the shipment's traveller's own page link (ship-8, shipportal.js)
//   teamAt(ctx, port)                              active members at an airport (messages, his page)
//   e164(phone)                                    a phone dialable from any country

import { getConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const iso = (d) => (d ? new Date(d).toISOString() : null);
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const PORTS = ['DAC', 'ICN'];

/** A phone a traveller can dial from any country: '+' and the country code. Bangladesh 01x.. and Korea 010.. are
 *  recognised without it; anything else must start with '+'. '' = not usable. */
export function e164(raw) {
  const s = str(raw); if (!s) return '';
  let d = s.replace(/\D/g, '');
  if (s.charAt(0) === '+' || /^00/.test(d)) { d = d.replace(/^00/, ''); return d.length >= 8 && d.length <= 15 ? '+' + d : ''; }
  if (/^01[3-9]\d{8}$/.test(d)) return '+88' + d;
  if (/^8801[3-9]\d{8}$/.test(d)) return '+' + d;
  if (/^010\d{8}$/.test(d)) return '+82' + d.slice(1);
  if (/^8210\d{8}$/.test(d)) return '+' + d;
  return '';
}

async function gate(ctx) {
  if (str(await getConfig(ctx, 'business_kind', '')) !== 'cargo') throw new Error('Shipments are only in the shipment business. Switch to it from the business menu.');
}
const out = (m) => ({ id: Number(m.id), name: m.name, phone: m.phone, role: m.role, port: m.port, photo: m.photo || '', active: !!m.active });

export async function teamAt(ctx, port) {
  return (await ctx.tx`select * from ship_team where business_id = ${ctx.biz} and port = ${port} and active order by sort, id`).map(out);
}

export async function erpShipTeam(ctx) {
  await gate(ctx);
  const rows = await ctx.tx`select * from ship_team where business_id = ${ctx.biz} order by active desc, port, sort, id`;
  return { team: rows.map(out), canEdit: roleAtLeast(ctx.s.role, 'manager') };
}

export async function erpShipTeamSave(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const name = str(p.name).slice(0, 80);
  if (!name) throw new Error('Write the person’s name.');
  const phone = e164(p.phone);
  if (!phone) throw new Error('Write a phone number the traveller can call from any country: + and the country code (for example +880 17.., +82 10..).');
  const port = PORTS.indexOf(str(p.port)) >= 0 ? str(p.port) : 'DAC';
  const role = str(p.role).slice(0, 80);
  const photo = p.photo === undefined ? undefined : str(p.photo);
  if (photo && (!IMG.test(photo) || photo.length > 400000)) throw new Error('That photo could not be used. Take it again or choose another one.');
  const active = p.active !== false;
  let id = int(p.id);
  if (id) {
    const had = (await ctx.tx`select id from ship_team where business_id = ${ctx.biz} and id = ${id}`)[0];
    if (!had) throw new Error('That person is not on the team any more.');
    await ctx.tx`update ship_team set name = ${name}, phone = ${phone}, role = ${role}, port = ${port}, active = ${active}, updated_at = now() where id = ${id}`;
    if (photo !== undefined) await ctx.tx`update ship_team set photo = ${photo} where id = ${id}`;
  } else {
    id = Number((await ctx.tx`insert into ship_team (business_id, name, phone, role, port, photo, active)
      values (${ctx.biz}, ${name}, ${phone}, ${role}, ${port}, ${photo || ''}, ${active}) returning id`)[0].id);
  }
  return erpShipTeam(ctx);
}

export async function erpShipShare(ctx, payload) {
  await gate(ctx);
  const s = (await ctx.tx`select carrier_id from ships where business_id = ${ctx.biz} and id = ${int(payload && payload.id)}`)[0];
  if (!s) throw new Error('That shipment is not here any more.');
  if (!s.carrier_id) throw new Error('Give the shipment a traveller first.');
  const { portalToken, portalUrl } = await import('./shipportal.js');
  const tok = await portalToken(ctx, Number(s.carrier_id));
  return { token: tok, url: portalUrl(ctx, tok) };
}

export const HANDLERS = { erpShipTeam, erpShipTeamSave, erpShipShare };
