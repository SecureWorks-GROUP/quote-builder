// Reads back what a PDF prints, the way a PDF viewer does (pdf.js), so the tests check the
// real file: compressed, with the brand typeface embedded.
'use strict';

const MM = 72 / 25.4;

// [{ number, items: [{ str, x, y }] }]: each printed piece of text on each page, with where
// it sits in mm from the top left of the page (y is the line the letters stand on).
async function pdfPages(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const height = page.getViewport({ scale: 1 }).height;
    const items = (await page.getTextContent()).items
      .filter((i) => i.str.trim())
      .map((i) => ({ str: i.str, x: i.transform[4] / MM, y: (height - i.transform[5]) / MM }));
    pages.push({ number: n, items });
  }
  await doc.destroy();
  return pages;
}

// Every printed piece as "(text)" on its own line, so a table cell can be matched whole.
function printed(pages) {
  return pages.map((p) => p.items.map((i) => '(' + i.str + ')').join('\n')).join('\n');
}

async function pdfWords(bytes) { return printed(await pdfPages(bytes)); }

// The page's words run together with single spaces: a description that wraps reads as typed.
function flow(page) { return page.items.map((i) => i.str).join(' ').replace(/\s+/g, ' '); }

// Lower case with no spaces. The small capital labels are letter-spaced, and pdf.js reads
// those back with a space between the letters, so labels are compared squashed.
function squash(s) { return String(s).replace(/\s+/g, '').toLowerCase(); }

module.exports = { pdfPages, pdfWords, printed, flow, squash };
