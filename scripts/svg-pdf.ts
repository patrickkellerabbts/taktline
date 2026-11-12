// SVG → PDF ohne Browser, für die Taktline-CLI (Gantt und PSP).
// pdfkit liefert die Seite, svg-to-pdfkit zeichnet das SVG als Vektorgrafik
// hinein. Schrift ist Helvetica bzw. Courier (PDF-Standardschriften), damit
// nichts eingebettet werden muss.
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

const MM = 72 / 25.4;

/** A3 oder A4 mit 5 mm Rand, Ausrichtung nach Seitenverhältnis; die Grafik wird proportional eingepasst. */
export async function svgToPdf(
  svg: string,
  options: { width: number; height: number; page: 'A3' | 'A4'; title: string },
): Promise<Buffer> {
  const [longSide, shortSide] = options.page === 'A3' ? [420, 297] : [297, 210];
  const portrait = options.height > options.width;
  const pageW = (portrait ? shortSide : longSide) * MM;
  const pageH = (portrait ? longSide : shortSide) * MM;
  const margin = 5 * MM;
  const scale = Math.min((pageW - 2 * margin) / options.width, (pageH - 2 * margin) / options.height);

  const doc = new PDFDocument({
    size: [pageW, pageH],
    margin: 0,
    info: { Title: options.title, Creator: 'Taktline' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  SVGtoPDF(doc, svg, margin, margin, {
    width: options.width * scale,
    height: options.height * scale,
    preserveAspectRatio: 'xMidYMin meet',
    assumePt: false,
    // Alle Schriften auf die eingebauten PDF-Schriften abbilden.
    fontCallback: (family, bold, italic) => {
      const base = /mono|menlo|courier|consolas/i.test(family) ? 'Courier' : 'Helvetica';
      if (bold && italic) return `${base}-BoldOblique`;
      if (bold) return `${base}-Bold`;
      if (italic) return `${base}-Oblique`;
      return base;
    },
  });
  doc.end();
  return done;
}
