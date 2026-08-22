import { code128, type DispatchView, type DocumentProfile } from '@vyuha/shared';

/**
 * The customer's mail for a dispatch (D-47): E1 when it ships, E2 when it
 * is delivered. Pure — text in, subject/text/html out — so the wording and
 * the markup are unit-tested without a mailbox. The HTML is table-and-inline
 * because that is what mail clients render; the barcode is a row of cells,
 * not an image, so Gmail does not strip it and nothing is fetched.
 */

export interface DispatchNoticeInput {
  readonly event: 'dispatched' | 'delivered';
  readonly orgName: string;
  readonly profile: DocumentProfile;
  readonly dispatch: DispatchView;
  /** The order's contact name, when one is known; the mail opens with it. */
  readonly contactName: string | null;
}

export interface DispatchNotice {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function esc(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

function longDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function barcodeCells(value: string): string {
  const { bars, width } = code128(value);
  const scale = 2;
  const cells: string[] = [];
  let x = 0;
  for (const [start, w] of bars) {
    if (start > x) cells.push(`<td style="width:${String((start - x) * scale)}px;background:#ffffff;padding:0;font-size:0;line-height:0">&nbsp;</td>`);
    cells.push(`<td style="width:${String(w * scale)}px;background:#111111;padding:0;font-size:0;line-height:0">&nbsp;</td>`);
    x = start + w;
  }
  if (x < width) cells.push(`<td style="width:${String((width - x) * scale)}px;background:#ffffff;padding:0;font-size:0;line-height:0">&nbsp;</td>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;height:44px;width:${String((width + 20) * scale)}px;background:#ffffff;padding:0 ${String(10 * scale)}px"><tr style="height:44px">${cells.join('')}</tr></table>`;
}

export function renderDispatchNotice(input: DispatchNoticeInput): DispatchNotice {
  const { event, orgName, profile, dispatch, contactName } = input;
  const name = profile.legalName.trim() === '' ? orgName : profile.legalName;
  const greeting = contactName === null || contactName.trim() === '' ? dispatch.customerName : contactName.split(/\s+/u)[0] ?? dispatch.customerName;
  const boxes = dispatch.lines.length;
  const items = dispatch.lines.map((line) => ({ description: line.description, qty: `${line.quantity}${line.unit ? ` ${line.unit}` : ''}` }));
  const address = profile.addressLines.split('\n').filter((l) => l.trim() !== '').join(', ');

  const outstation = dispatch.mode === 'outstation';
  const transport = outstation
    ? `${dispatch.transporterName ?? 'the transporter'}${dispatch.transporterContact ? ` (${dispatch.transporterContact})` : ''}`
    : dispatch.mode === 'local_own_vehicle'
      ? `our own vehicle${dispatch.vehicleNumber ? ` ${dispatch.vehicleNumber}` : ''}${dispatch.driverName ? `, driver ${dispatch.driverName}` : ''}`
      : 'local delivery';
  const expected = dispatch.expectedDeliveryDate === null ? null : longDate(dispatch.expectedDeliveryDate);

  const subject =
    event === 'dispatched'
      ? `${dispatch.orderNumber} is on its way${dispatch.lrNumber ? ` — LR ${dispatch.lrNumber}` : ''}`
      : `${dispatch.orderNumber} delivered${dispatch.receivedBy ? ` — received by ${dispatch.receivedBy}` : ''}`;

  const headline = event === 'dispatched' ? `Your order is on its way, ${greeting}.` : `Delivered${dispatch.receivedBy ? ` to ${dispatch.receivedBy}` : ''}.`;
  const lede =
    event === 'dispatched'
      ? `${String(boxes)} line${boxes === 1 ? '' : 's'} left with ${transport}${expected ? `. Expected by ${expected}` : ''}.`
      : `${dispatch.orderNumber} (${dispatch.number}) was handed over${dispatch.deliveredAt ? ` on ${longDate(dispatch.deliveredAt)}` : ''}${dispatch.deliveryNote ? `. ${dispatch.deliveryNote}` : ''}. If anything is short or damaged, reply within two working days quoting ${dispatch.number}.`;

  const facts: [string, string][] = [
    ['Order', dispatch.orderNumber],
    ['Dispatch', dispatch.number],
    ...(outstation && dispatch.transporterName ? [['Transporter', `${dispatch.transporterName}${dispatch.transporterContact ? ` · ${dispatch.transporterContact}` : ''}`] as [string, string]] : []),
    ...(dispatch.vehicleNumber ? [['Vehicle', dispatch.vehicleNumber] as [string, string]] : []),
    ...(expected && event === 'dispatched' ? [['Expected', expected] as [string, string]] : []),
    ...(event === 'delivered' && dispatch.receivedBy ? [['Received by', dispatch.receivedBy] as [string, string]] : []),
  ];

  const text = [
    `${headline}`,
    lede,
    '',
    ...(event === 'dispatched' && dispatch.lrNumber ? [`LR number (quote this to the transporter): ${dispatch.lrNumber}`, ''] : []),
    ...facts.map(([k, v]) => `${k}: ${v}`),
    '',
    ...items.map((i) => `- ${i.description}: ${i.qty}`),
    '',
    `Reply to this mail with any question${profile.phone.trim() === '' ? '' : `, or call ${profile.phone}`}.`,
    '',
    `${name}${address ? ` · ${address}` : ''}${profile.gstin.trim() === '' ? '' : ` · GSTIN ${profile.gstin}`}`,
    'You receive this because a dispatch was made against your order. Sent from Vyuha.',
  ].join('\n');

  const big =
    event === 'dispatched' && dispatch.lrNumber
      ? `<tr><td style="padding:12px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #111111;border-collapse:collapse"><tr><td style="padding:12px 16px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif"><div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;font-weight:600">LR number — quote this to the transporter</div><div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:.04em;color:#111111;padding-top:4px">${esc(dispatch.lrNumber)}</div></td><td style="padding:12px 16px;text-align:right">${barcodeCells(dispatch.number)}<div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.18em;color:#111111;padding-top:2px">${esc(dispatch.number)}</div></td></tr></table></td></tr>`
      : `<tr><td style="padding:12px 24px 0;text-align:left">${barcodeCells(dispatch.number)}<div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.18em;color:#111111;padding-top:2px">${esc(dispatch.number)}</div></td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;font-family:-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;color:#111111">
<tr><td style="padding:18px 24px;border-bottom:1px solid #e5e7eb"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:15px;font-weight:700">${esc(name)}</td><td style="text-align:right;font-size:12px;color:#6b7280">${event === 'dispatched' ? 'Dispatch notice' : 'Delivery notice'}</td></tr></table></td></tr>
<tr><td style="padding:22px 24px 6px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;font-weight:600">${event === 'dispatched' ? 'Shipped' : 'Delivered'}</div><h1 style="margin:6px 0 0;font-size:22px;font-weight:700;letter-spacing:-.01em;line-height:1.2">${esc(headline)}</h1><p style="margin:8px 0 0;color:#374151;font-size:15px;line-height:1.5">${esc(lede)}</p></td></tr>
${big}
<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${facts
    .map(([k, v]) => `<tr><td style="padding:4px 0;width:40%"><span style="display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;font-weight:600">${esc(k)}</span>${esc(v)}</td></tr>`)
    .join('')}</table></td></tr>
<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;font-size:14px">${items
    .map((i) => `<tr><td style="padding:7px 0;border-bottom:1px solid #f0f1f3">${esc(i.description)}</td><td style="padding:7px 0;border-bottom:1px solid #f0f1f3;text-align:right;font-family:ui-monospace,Menlo,monospace;color:#374151">${esc(i.qty)}</td></tr>`)
    .join('')}</table></td></tr>
<tr><td style="padding:18px 24px 0;font-size:14px;color:#374151">Reply to this mail with any question${profile.phone.trim() === '' ? '' : `, or call ${esc(profile.phone)}`}.</td></tr>
<tr><td style="padding:18px 24px;margin-top:18px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5"><b style="color:#111111">${esc(name)}</b><br>${esc(address)}${profile.gstin.trim() === '' ? '' : ` · GSTIN ${esc(profile.gstin)}`}<br>You receive this because a dispatch was made against your order. Sent from Vyuha.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
