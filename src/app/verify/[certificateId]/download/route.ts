import { CertificateType } from "@prisma/client";
import { CERTIFICATE_TYPES } from "@/features/certificate/constants";
import { getPublicCertificate } from "@/features/certificate/get-certificate";
import { renderCertificatePdf } from "@/features/certificate/render-certificate-pdf";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safePdfFilename(
  fullName: string,
  cert: { type: CertificateType; certificateId: string },
): string {
  const namePart =
    fullName
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "recipient";
  return `ABTalks-${CERTIFICATE_TYPES[cert.type].fileSlug}-${namePart}-${cert.certificateId}.pdf`;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await context.params;
  const cert = await getPublicCertificate(certificateId);
  if (!cert) {
    return new Response("Not found", { status: 404 });
  }
  if (cert.isRevoked) {
    return new Response("This certificate has been revoked", { status: 410 });
  }

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://abtalks.in";
  const verifyUrl = `${base}/verify/${cert.certificateId}`;

  const searchParams = new URL(req.url).searchParams;
  const inline = searchParams.get("inline") === "1";
  const debugGrid =
    process.env.NODE_ENV !== "production" &&
    searchParams.get("debug") === "grid";

  try {
    const bytes = await renderCertificatePdf({
      type: cert.type,
      recipientName: cert.recipientName,
      certificateId: cert.certificateId,
      issuedOn: cert.issuedOn,
      verifyUrl,
      debugGrid,
    });

    const safeFilename = safePdfFilename(cert.recipientName, cert);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeFilename}"`,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNRENDERABLE_NAME") {
      return new Response(
        "Your profile name cannot be rendered on the certificate. Please update it to Latin characters and contact support to re-issue.",
        { status: 422 },
      );
    }

    logger.error("Could not generate certificate", {
      certificateId: cert.certificateId,
      error: String(error),
    });
    return new Response("Could not generate certificate", { status: 500 });
  }
}
