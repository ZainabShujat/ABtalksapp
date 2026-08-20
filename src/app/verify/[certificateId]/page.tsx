import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { getPublicCertificate } from "@/features/certificate/get-certificate";
import { CertificatePreviewPanel } from "@/components/certificate/certificate-preview-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ certificateId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { certificateId } = await params;
  return {
    title: `Verify certificate ${certificateId.toUpperCase()} · ABTalks`,
    robots: { index: false, follow: false },
  };
}

export default async function VerifyCertificatePage({ params }: PageProps) {
  const { certificateId } = await params;
  const cert = await getPublicCertificate(certificateId);

  if (!cert) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-12">
        <Card className="w-full max-w-2xl">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="size-6 text-destructive" aria-hidden />
            </div>
            <CardTitle>Certificate not found</CardTitle>
            <CardDescription>
              We couldn&apos;t find a certificate with the ID{" "}
              <span className="font-mono">{certificateId}</span>. Check the ID
              and try again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
              Go to ABTalks
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (cert.isRevoked) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-12">
        <Card className="w-full max-w-2xl">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldX className="size-6 text-destructive" aria-hidden />
            </div>
            <CardTitle>This certificate has been revoked</CardTitle>
            <CardDescription>
              Certificate{" "}
              <span className="font-mono">{cert.certificateId}</span> issued on{" "}
              {cert.issuedOn} is no longer valid.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // `#toolbar=0&navpanes=0&view=FitH` are PDF open-parameter hints — Chrome honours them,
  // Firefox's pdf.js ignores most. Harmless either way; the fragment must follow the query.
  const previewSrc = `/verify/${cert.certificateId}/download?inline=1#toolbar=0&navpanes=0&view=FitH`;

  return (
    <div className="min-h-svh bg-muted/30 px-4 py-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-stretch">
        <Card className="min-w-0 lg:h-full">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-green-600/10">
              <ShieldCheck className="size-6 text-green-600" aria-hidden />
            </div>
            <CardTitle className="text-green-700 dark:text-green-500">
              Verified Certificate
            </CardTitle>
            <CardDescription>{cert.subtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Recipient</dt>
                <dd className="font-medium">{cert.recipientName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Credential</dt>
                <dd className="font-medium">{cert.title}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Issued on</dt>
                <dd className="font-medium">{cert.issuedOn}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Certificate ID</dt>
                <dd className="font-mono font-medium">{cert.certificateId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge className="bg-green-600 text-white hover:bg-green-600/90">
                    {cert.statusLabel}
                  </Badge>
                </dd>
              </div>
              {cert.details.map((detail) => (
                <div key={detail.label}>
                  <dt className="text-muted-foreground">{detail.label}</dt>
                  <dd className="font-medium">{detail.value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex justify-center">
              <a
                href={`/verify/${cert.certificateId}/download`}
                download
                className={cn(buttonVariants())}
              >
                Download certificate
              </a>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Issued by ABTalks · abtalks.in
            </p>
          </CardContent>
        </Card>

        <CertificatePreviewPanel
          previewSrc={previewSrc}
          certificateId={cert.certificateId}
        />
      </div>
    </div>
  );
}
