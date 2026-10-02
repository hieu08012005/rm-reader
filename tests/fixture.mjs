import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFHexString } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function createFixture(filename, count = 400) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('RM Reader - Embedded navigation demo');
  pdf.setAuthor('RM Reader demo - not a manufacturer manual');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = [];
  const targets = count >= 400 ? [1, 300, 350, 399] : [1, 3, 5, 7];
  for (let i = 1; i <= count; i++) {
    const page = pdf.addPage([595, 842]); pages.push(page);
    page.drawText('EMBEDDED REFERENCE MANUAL / DEMO', { x: 52, y: 785, size: 10, color: rgb(.2,.5,.45), font: bold });
    page.drawText(`Section ${i} - GPIO and interrupt control`, { x: 52, y: 737, size: 22, font: bold });
    const lines = [
      'The interrupt flag is set when a rising edge is detected.',
      'Write one to clear the pending interrupt flag.',
      'GPIOA and TIMx_CR1 are memory-mapped registers.',
      'The peripheral clock is divided by the prescaler.',
      'Register address: 0x40020000. Read the status register.',
      'Use volatile for hardware registers accessed by C code.',
      'A pull-up resistor holds the input pin at a high level.',
      'DMA transfers data without repeated CPU intervention.'
    ];
    lines.forEach((line, index) => page.drawText(line, { x: 52, y: 675-index*31, size: 12, font }));
    page.drawText('interrupt', { x: 52, y: 385, size: 14, font });
    page.drawText('register', { x: 160, y: 385, size: 14, font });
    page.drawText('clock', { x: 260, y: 385, size: 14, font });
    page.drawText(`Page ${i} of ${count}`, { x: 52, y: 35, size: 10, font, color: rgb(.6,.65,.65) });
  }
  const ctx = pdf.context;
  for (let i = 0; i < targets.length - 1; i++) {
    const page = pages[targets[i]-1], destination = pages[targets[i+1]-1];
    const label = `See section ${targets[i+1]} - peripheral register`;
    page.drawText(label, { x: 52, y: 320, size: 13, font, color: rgb(.06,.35,.8) });
    const rect = [50, 316, 50 + font.widthOfTextAtSize(label, 13) + 4, 336];
    const dest = ctx.obj([destination.ref, PDFName.of('XYZ'), 0, 650-i*100, 1.5]);
    const annotation = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0,0,0], Dest: i === 1 ? PDFString.of('register-section') : dest }));
    page.node.set(PDFName.of('Annots'), ctx.obj([annotation]));
    if (i === 1) pdf.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: { Names: [PDFString.of('register-section'), dest] } }));
  }
  const outlines = ctx.obj({ Type: 'Outlines', Count: 2 }); const outlinesRef = ctx.register(outlines);
  const first = ctx.obj({ Title: PDFHexString.fromText('1. GPIO overview'), Parent: outlinesRef, Dest: [pages[0].ref, PDFName.of('XYZ'), 0, 740, null], Count: 1 });
  const firstRef = ctx.register(first);
  const child = ctx.obj({ Title: PDFHexString.fromText('1.1 Interrupt flags'), Parent: firstRef, Dest: [pages[targets[1]-1].ref, PDFName.of('XYZ'), 0, 550, null] });
  const childRef = ctx.register(child); first.set(PDFName.of('First'), childRef); first.set(PDFName.of('Last'), childRef);
  const second = ctx.obj({ Title: PDFHexString.fromText('2. Peripheral registers'), Parent: outlinesRef, Prev: firstRef, Dest: [pages[targets[2]-1].ref, PDFName.of('XYZ'), 0, 650, null] });
  const secondRef = ctx.register(second); first.set(PDFName.of('Next'), secondRef);
  outlines.set(PDFName.of('First'), firstRef); outlines.set(PDFName.of('Last'), secondRef);
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, await pdf.save());
}
