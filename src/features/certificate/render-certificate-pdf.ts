import "server-only";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import QRCode from "qrcode";
import type { CertificateType } from "@prisma/client";
import {
  CERTIFICATE_LAYOUTS,
  CERTIFICATE_TYPES,
  type CertificateTextStamp,
} from "./constants";
import { loadCertificateTemplate } from "./template-source";

export function toWinAnsiSafe(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function drawCalibrationGrid(page: PDFPage, font: PDFFont): void {
  const { width, height } = page.getSize();
  for (let i = 1; i < 20; i += 1) {
    const r = i / 20;
    page.drawLine({
      start: { x: width * r, y: 0 },
      end: { x: width * r, y: height },
      thickness: 0.3,
      color: rgb(1, 0, 0),
      opacity: 0.35,
    });
    page.drawLine({
      start: { x: 0, y: height * r },
      end: { x: width * r, y: height * r },
      thickness: 0.3,
      color: rgb(0, 0, 1),
      opacity: 0.35,
    });
    page.drawText(r.toFixed(2), {
      x: width * r + 1,
      y: 3,
      size: 5,
      font,
      color: rgb(1, 0, 0),
    });
    page.drawText(r.toFixed(2), {
      x: 3,
      y: height * r + 1,
      size: 5,
      font,
      color: rgb(0, 0, 1),
    });
  }
}

export async function renderCertificatePdf(input: {
  type: CertificateType;
  recipientName: string;
  certificateId: string;
  /** Already formatted IST string, e.g. "12 Mar 2026". Formatted by the caller. */
  issuedOn: string;
  verifyUrl: string;
  /** Draws a calibration grid over the page. Dev only. */
  debugGrid?: boolean;
}): Promise<Uint8Array> {
  const { recipientName, certificateId, issuedOn, verifyUrl, debugGrid } =
    input;
  const safeName = toWinAnsiSafe(recipientName);
  if (!safeName) {
    throw new Error("UNRENDERABLE_NAME");
  }

  const layout = CERTIFICATE_LAYOUTS[input.type];
  if (!layout) {
    throw new Error(`No certificate layout for type ${input.type}`);
  }
  const pdfDoc = await PDFDocument.load(await loadCertificateTemplate(input.type), {
    updateMetadata: false,
  });
  const page = pdfDoc.getPages()[0];
  if (!page) {
    throw new Error("Certificate template has no pages");
  }
  const { width, height } = page.getSize();

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  function drawStamp(text: string, stamp: CertificateTextStamp) {
    const font = stamp.bold ? boldFont : regularFont;
    const x =
      stamp.align === "center"
        ? width * stamp.centerXRatio - font.widthOfTextAtSize(text, stamp.fontSize) / 2
        : width * stamp.xRatio;
    page.drawText(text, {
      x,
      y: height * stamp.baselineYRatio,
      size: stamp.fontSize,
      font,
      color: rgb(stamp.color.r, stamp.color.g, stamp.color.b),
    });
  }

  drawStamp(issuedOn, layout.issuedOn);
  drawStamp(certificateId, layout.certificateId);

  const nameFont = layout.name.bold ? boldFont : regularFont;
  const maxWidth = width * layout.name.maxWidthRatio;
  let size = layout.name.fontSize;
  let textWidth = nameFont.widthOfTextAtSize(safeName, size);
  while (textWidth > maxWidth && size > layout.name.minFontSize) {
    size -= 1;
    textWidth = nameFont.widthOfTextAtSize(safeName, size);
  }
  page.drawText(safeName, {
    x: width * layout.name.centerXRatio - textWidth / 2,
    y: height * layout.name.baselineYRatio,
    size,
    font: nameFont,
    color: rgb(layout.name.color.r, layout.name.color.g, layout.name.color.b),
  });

  const qrPng = await QRCode.toBuffer(verifyUrl, {
    type: "png",
    margin: 1,
    width: 512,
    errorCorrectionLevel: "M",
    color: { dark: "#000000FF", light: "#FFFFFFFF" },
  });
  const qrImage = await pdfDoc.embedPng(qrPng);
  const qrSize = width * layout.qr.sizeRatio;
  page.drawImage(qrImage, {
    x: width * layout.qr.xRatio,
    y: height * layout.qr.yRatio,
    width: qrSize,
    height: qrSize,
  });

  if (layout.verifyText) {
    page.drawText(verifyUrl.replace(/^https?:\/\//, ""), {
      x: width * layout.verifyText.xRatio,
      y: height * layout.verifyText.baselineYRatio,
      size: layout.verifyText.fontSize,
      font: layout.verifyText.bold ? boldFont : regularFont,
      color: rgb(
        layout.verifyText.color.r,
        layout.verifyText.color.g,
        layout.verifyText.color.b,
      ),
    });
  }

  pdfDoc.setTitle(`ABTalks Certificate — ${certificateId}`);
  pdfDoc.setAuthor("ABTalks");
  pdfDoc.setSubject(`${CERTIFICATE_TYPES[input.type].title} Certificate`);
  pdfDoc.setKeywords([certificateId]);
  pdfDoc.setProducer("ABTalks");

  if (debugGrid) {
    drawCalibrationGrid(page, boldFont);
  }

  return await pdfDoc.save();
}
