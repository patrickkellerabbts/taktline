// svg-to-pdfkit bringt keine Typen mit; genutzt nur von der Taktline-CLI.
declare module 'svg-to-pdfkit' {
  const SVGtoPDF: (
    doc: unknown,
    svg: string,
    x?: number,
    y?: number,
    options?: {
      width?: number;
      height?: number;
      preserveAspectRatio?: string;
      assumePt?: boolean;
      fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
    },
  ) => void;
  export default SVGtoPDF;
}
