// A made-up quote for the PDF layout tests and the stills in docs/quote-template. Every
// name, address, job number and price here is invented: the repo is public, so nothing
// real goes in a fixture.
'use strict';

const JOB = {
  job_number: 'SWR-99001', type: 'repair', client_name: 'Alex Sample', client_phone: '', client_email: '',
  site_address: '10 Example Street', site_suburb: 'Sample Suburb',
  builder_name: 'Example Builders', builder_work_order: 'EB-0001', builder_purchase_order: 'PO-0001'
};

const NARRATIVE = [
  'Storm damage to the rear patio roof and the gutter along the back of the house.',
  'We will remove the three damaged roof sheets and the bent gutter run, check the beam and the fixings underneath, fit new sheets and gutter to match what is there, seal the flashings and leave the site clean.',
  'Access is through the side gate. Work is expected to take two days, weather permitting.'
].join('\n\n');

const LINES = [
  { description: 'Remove and dispose of damaged roof sheets and gutter', qty: 1, unit: 'item', unit_price_ex_gst: 300 },
  { description: 'Supply and install roof sheets to match existing, including fixings and sealing of the flashings along the house wall', qty: 12.5, unit: 'm2', unit_price_ex_gst: 80 },
  { description: 'Supply and install gutter to match existing', qty: 9, unit: 'm', unit_price_ex_gst: 60 },
  { description: 'Labour to check beam and replace fixings', qty: 4, unit: 'hr', unit_price_ex_gst: 100 },
  { description: 'Council verge permit, passed on at cost', qty: 1, unit: 'item', unit_price_ex_gst: 50, gst_applies: false }
];

// A long quote: `count` made-up lines, every third one long enough to wrap, so the pricing
// table has to run over a page.
function manyLines(count) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    const long = i % 3 === 0 ? ', including removal of the old one, all fixings, sealing and making good to match what is there' : '';
    out.push({ description: 'Made-up repair item ' + i + long, qty: i, unit: i % 2 ? 'm' : 'item', unit_price_ex_gst: 10 + i });
  }
  return out;
}

function quote(over) {
  return Object.assign({
    job: JOB, kind: 'scope', quoteNumber: 'SWR-99001-Q1', date: '2026-10-13T02:00:00Z', preparedBy: 'Sam Example',
    version: { title: 'Storm damage repair to patio roof and gutter', narrative: NARRATIVE, charge_lines: LINES },
    photos: []
  }, over || {});
}

module.exports = { JOB, NARRATIVE, LINES, manyLines, quote };
