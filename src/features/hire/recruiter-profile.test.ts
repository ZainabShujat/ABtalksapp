/**
 * T-227 — Recruiter Profile & Company Identity.
 *
 * A recruiter can view and edit their own profile (full name, phone) and
 * company identity (company name, website, industry, size, location).
 * Changes persist in the database and are strictly isolated per recruiter workspace.
 *
 * Run: npm run test:recruiter-profile
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  LOGO_MAX_BYTES,
  isAllowedLogoMimeType,
  updateRecruiterProfileSchema,
} from "@/lib/validations/recruiter-profile";
import { registerRecruiterSchema } from "@/lib/validations/recruiter-auth";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

function source(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

console.log("\nT-227 recruiter profile & company identity");

// =========================================================================
// 1. Schema & Validation Tests
// =========================================================================

suite("valid full profile input passes Zod parsing", () => {
  const input = {
    fullName: "  Jane Recruiter  ",
    phone: "+1 555-0199",
    companyName: "Acme Technologies",
    website: "https://acme.example.com",
    industry: "Enterprise SaaS",
    companySize: "50-200",
    location: "San Francisco, CA",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(parsed.success, "valid input must parse successfully");
  if (parsed.success) {
    assert(parsed.data.fullName === "Jane Recruiter", "fullName must be trimmed");
    assert(parsed.data.phone === "+1 555-0199", "phone must match");
    assert(parsed.data.companyName === "Acme Technologies", "companyName must match");
    assert(parsed.data.website === "https://acme.example.com", "website must match");
    assert(parsed.data.industry === "Enterprise SaaS", "industry must match");
    assert(parsed.data.companySize === "50-200", "companySize must match");
    assert(parsed.data.location === "San Francisco, CA", "location must match");
  }
});

suite("minimal input with only name and company passes and converts empties to null", () => {
  const input = {
    fullName: "Alice Smith",
    phone: "",
    companyName: "Hiring Corp",
    website: "",
    industry: "   ",
    companySize: null,
    location: undefined,
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(parsed.success, "minimal input must succeed");
  if (parsed.success) {
    assert(parsed.data.fullName === "Alice Smith", "name preserved");
    assert(parsed.data.phone === null, "empty phone converted to null");
    assert(parsed.data.website === null, "empty website converted to null");
    assert(parsed.data.industry === null, "whitespace industry converted to null");
    assert(parsed.data.companySize === null, "null companySize converted to null");
    assert(parsed.data.location === null, "undefined location converted to null");
  }
});

suite("website without protocol is auto-prefixed with https://", () => {
  const input = {
    fullName: "Bob Recruiter",
    companyName: "TechWorks",
    website: "techworks.io",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(parsed.success, "bare domain website should parse");
  if (parsed.success) {
    assert(parsed.data.website === "https://techworks.io", "should prepend https://");
  }
});

suite("invalid website string is rejected", () => {
  const input = {
    fullName: "Bob Recruiter",
    companyName: "TechWorks",
    website: "not a valid url @@@",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(!parsed.success, "malformed website must fail");
});

suite("invalid phone format or letters is rejected", () => {
  const input = {
    fullName: "Bob Recruiter",
    companyName: "TechWorks",
    phone: "call-me-maybe-1234",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(!parsed.success, "phone with letters must fail");
});

suite("phone with arbitrary characters like = and letters (e.g. 12324u5i855=357ui3) is rejected", () => {
  const input = {
    fullName: "Bob Recruiter",
    companyName: "TechWorks",
    phone: "12324u5i855=357ui3",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(!parsed.success, "phone with = and letters must fail");
});

suite("phone under 7 digits or formatting only is rejected", () => {
  const inputTooShort = {
    fullName: "Bob Recruiter",
    companyName: "TechWorks",
    phone: "12345",
  };
  assert(!updateRecruiterProfileSchema.safeParse(inputTooShort).success, "5 digit phone must fail");

  const inputSymbolsOnly = {
    fullName: "Bob Recruiter",
    companyName: "TechWorks",
    phone: "(---)----",
  };
  assert(!updateRecruiterProfileSchema.safeParse(inputSymbolsOnly).success, "symbols only must fail");
});

suite("valid formatted international phone numbers are accepted", () => {
  const validNumbers = [
    "+1 555-0199",
    "+91 98765 43210",
    "(555) 123-4567",
    "+44 20 7946 0991",
    "9876543210",
  ];
  for (const phone of validNumbers) {
    const input = {
      fullName: "Bob Recruiter",
      companyName: "TechWorks",
      phone,
    };
    const parsed = updateRecruiterProfileSchema.safeParse(input);
    assert(parsed.success, `phone "${phone}" should be accepted`);
  }
});

suite("phone exceeding 25 characters is rejected", () => {
  const input = {
    fullName: "Bob Recruiter",
    companyName: "TechWorks",
    phone: "+1 23456789012345678901234567",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(!parsed.success, "phone > 25 chars must fail");
});

suite("short or empty full name is rejected", () => {
  const input = {
    fullName: "A",
    companyName: "TechWorks",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(!parsed.success, "single char name must fail");
});

suite("short or empty company name is rejected", () => {
  const input = {
    fullName: "Valid Name",
    companyName: " ",
  };
  const parsed = updateRecruiterProfileSchema.safeParse(input);
  assert(!parsed.success, "empty company name must fail");
});

// =========================================================================
// 2. Database Schema & Migration Assertions
// =========================================================================

suite("Organization model in schema.prisma has location column", () => {
  const schema = source("prisma/schema.prisma");
  assert(
    schema.includes("model Organization {") && schema.includes("location   String?"),
    "Organization model must include location String?",
  );
});

suite("migration exists for Organization location column", () => {
  const migrationPath =
    "prisma/migrations/20260911230000_organization_location/migration.sql";
  assert(existsSync(join(process.cwd(), migrationPath)), "migration file must exist");
  const sql = source(migrationPath);
  assert(
    sql.includes('ALTER TABLE "Organization" ADD COLUMN "location" TEXT;'),
    "migration must add location column to Organization",
  );
});

// =========================================================================
// 3. Security, Workspace Boundary & Isolation Source Scans
// =========================================================================

suite("getRecruiterProfileAction resolves workspace from session with requireRecruiterWorkspace", () => {
  const src = source("src/app/actions/recruiter-profile-actions.ts");
  assert(
    src.includes("requireRecruiterWorkspace"),
    "must call requireRecruiterWorkspace",
  );
  assert(
    src.includes("export async function getRecruiterProfileAction():"),
    "must take no client arguments",
  );
});

suite("updateRecruiterProfileAction takes no caller-supplied user or org IDs", () => {
  const src = source("src/app/actions/recruiter-profile-actions.ts");
  assert(
    !src.includes("input.userId") &&
      !src.includes("input.organizationId") &&
      !src.includes("input.recruiterProfileId"),
    "must never accept caller-supplied user or org IDs",
  );
  assert(
    src.includes("workspace.data") &&
      src.includes("recruiterProfileId") &&
      src.includes("organizationId"),
    "must use server-resolved workspace IDs",
  );
});

suite("updateRecruiterProfileAction atomically updates RecruiterProfile and Organization in a transaction", () => {
  const src = source("src/app/actions/recruiter-profile-actions.ts");
  assert(
    src.includes("prisma.$transaction"),
    "updates must occur within a transaction",
  );
  assert(
    src.includes("tx.recruiterProfile.update") &&
      src.includes("tx.organization.update"),
    "both RecruiterProfile and Organization must be updated",
  );
  assert(
    src.includes("company: data.companyName") &&
      src.includes("name: data.companyName"),
    "RecruiterProfile.company and Organization.name must be kept synchronized",
  );
  assert(
    src.includes("location: data.location"),
    "Organization.location must be updated",
  );
});

suite("settings page requires recruiter authentication", () => {
  const src = source("src/app/hire/settings/page.tsx");
  assert(
    src.includes("requireRecruiter"),
    "settings page must call requireRecruiter()",
  );
  assert(
    src.includes("RecruiterProfileForm"),
    "settings page must render RecruiterProfileForm",
  );
});

suite("sidebar includes Settings navigation link for recruiters", () => {
  const src = source("src/components/hire/hire-sidebar.tsx");
  assert(
    src.includes('href="/hire/settings"'),
    "sidebar must link to /hire/settings",
  );
  assert(
    src.includes("Settings"),
    "sidebar must display Settings label/icon",
  );
});

// =========================================================================
// Full name rejects digits (issue #522)
// =========================================================================

const BASE_PROFILE = {
  phone: null,
  companyName: "Acme Technologies",
  website: null,
  industry: null,
  companySize: null,
  location: null,
};

suite("profile full name rejects digits", () => {
  for (const name of ["Sarthak123", "123", "Jane 2 Doe", "A1"]) {
    const parsed = updateRecruiterProfileSchema.safeParse({
      ...BASE_PROFILE,
      fullName: name,
    });
    assert(!parsed.success, `"${name}" must be rejected`);
  }
});

suite("profile full name still accepts real names", () => {
  // Hyphens, apostrophes, periods, particles and non-Latin scripts are all
  // things a real name carries. None of them may be collateral damage.
  for (const name of [
    "Jane Recruiter",
    "Mary-Jane O'Connor",
    "Dr. A. P. J. Abdul Kalam",
    "Jean-Luc de la Fontaine",
    "Ravi Shankar",
    "Zoë Ångström",
  ]) {
    const parsed = updateRecruiterProfileSchema.safeParse({
      ...BASE_PROFILE,
      fullName: name,
    });
    assert(parsed.success, `"${name}" must still be accepted`);
  }
});

suite("registration full name rejects digits", () => {
  const base = {
    company: "Acme Technologies",
    email: "jane@acme.com",
    code: "123456",
    acceptedTerms: true as const,
    newsletterOptIn: false,
  };
  const bad = registerRecruiterSchema.safeParse({ ...base, fullName: "Sarthak123" });
  assert(!bad.success, "a digit in the name must fail registration too");
  const good = registerRecruiterSchema.safeParse({ ...base, fullName: "Jane Recruiter" });
  assert(good.success, "a clean name must still register");
});

suite("the onboarding wizard mirrors the server rule", () => {
  // Otherwise the step passes and the failure only surfaces at submit, on a
  // screen that no longer shows the name field.
  const src = readFileSync(
    join(process.cwd(), "src/components/recruiter-onboarding/steps/identity-step.tsx"),
    "utf8",
  );
  assert(
    src.includes("\\p{Nd}"),
    "validateIdentity must reject digits in the name",
  );
  assert(
    src.includes("Full name cannot contain numbers."),
    "the wizard must use the same message as the schema",
  );
});

// =========================================================================
// Company logo (plan 158)
// =========================================================================

suite("the logo is NOT settable through the text form schema", () => {
  // The whole point: Organization.logoUrl may only ever hold a URL the upload
  // action got back from blob storage. If it became a text field, a recruiter
  // could point their company logo at any URL on the internet.
  const parsed = updateRecruiterProfileSchema.safeParse({
    fullName: "Jane Recruiter",
    phone: null,
    companyName: "Acme Technologies",
    website: null,
    industry: null,
    companySize: null,
    location: null,
    logoUrl: "https://evil.example.com/tracker.png",
  });
  assert(parsed.success, "an extra key must not fail the parse");
  if (parsed.success) {
    assert(
      !("logoUrl" in parsed.data),
      "logoUrl must be stripped by the schema, never carried into the update",
    );
  }
});

suite("the logo mime allow-list excludes SVG", () => {
  assert(!isAllowedLogoMimeType("image/svg+xml"), "SVG must be refused");
  assert(!isAllowedLogoMimeType("text/html"), "HTML must be refused");
  assert(!isAllowedLogoMimeType("application/pdf"), "PDF must be refused");
  for (const ok of ["image/png", "image/jpeg", "image/webp"]) {
    assert(isAllowedLogoMimeType(ok), `${ok} must be allowed`);
  }
  assert(LOGO_MAX_BYTES === 2 * 1024 * 1024, "the cap is 2 MB");
});

suite("uploadCompanyLogoAction takes no caller-supplied user or org IDs", () => {
  const src = source("src/app/actions/recruiter-profile-actions.ts");
  const action = src.slice(src.indexOf("export async function uploadCompanyLogoAction"));
  assert(
    action.includes("await requireRecruiterWorkspace()"),
    "the upload must resolve the workspace server-side",
  );
  assert(
    !action.includes('formData.get("organizationId")') &&
      !action.includes('formData.get("userId")'),
    "identity must never come from the FormData",
  );
});

suite("the logo blob path is built only from server-resolved values", () => {
  const src = source("src/features/hire/org-logo-storage.ts");
  assert(
    src.includes("`org-logos/${organizationId}/${contentHash}.${ext}`"),
    "path must be org-logos/<organizationId>/<sha256>.<ext>",
  );
  assert(
    !src.includes("file.name") && !src.includes("originalName"),
    "the uploaded filename must never reach the path — that is traversal",
  );
});

suite("the upload sniffs magic bytes and requires them to match the declared type", () => {
  // Plan 159 moved these checks into org-logo-storage.readLogoUpload so the
  // recruiter's own control and the admin create form share ONE copy of them.
  const src = source("src/features/hire/org-logo-storage.ts");
  assert(src.includes("function sniffImageType"), "a byte sniff must exist");
  assert(
    src.includes("sniffed.mime !== file.type"),
    "the sniffed type must be required to equal the declared type",
  );
  assert(
    src.includes('file.type === "image/svg+xml"'),
    "SVG must be refused explicitly, before the allow-list",
  );
  assert(
    src.includes("file.size > LOGO_MAX_BYTES"),
    "the size cap must be enforced on the server, not just in the browser",
  );
});

suite("both logo upload paths go through the one shared validation", () => {
  const recruiter = source("src/app/actions/recruiter-profile-actions.ts");
  const admin = source("src/app/actions/admin-recruiter-actions.ts");
  for (const [label, src] of [
    ["the recruiter's own control", recruiter],
    ["the admin create form", admin],
  ] as const) {
    assert(src.includes("readLogoUpload("), `${label} must call readLogoUpload`);
    assert(
      !src.includes("function sniffImageType"),
      `${label} must not carry its own copy of the byte sniff`,
    );
  }
});

suite("the logo store is public and is never the private résumé store", () => {
  const src = source("src/features/hire/org-logo-storage.ts");
  assert(src.includes('access: "public"'), "logos are rendered by <img src>");
  // The env list, not the prose — the header comment names the résumé token in
  // order to explain why it is NOT used.
  const envs = src.slice(
    src.indexOf("const TOKEN_ENVS"),
    src.indexOf("function blobToken"),
  );
  assert(envs.length > 0, "TOKEN_ENVS must be declared");
  assert(
    !envs.includes("resume2_READ_WRITE_TOKEN") &&
      !envs.includes("BLOB_READ_WRITE_TOKEN"),
    "the résumé store is private and must not be used or fallen back to",
  );
  assert(
    src.includes("...options()") && src.includes("token: blobToken()"),
    "the token must be passed explicitly so the SDK cannot pick another store",
  );
  assert(
    src.includes('import "server-only"'),
    "blob credentials must never be reachable from a client component",
  );
});

suite("the old blob is deleted only after the row stops pointing at it", () => {
  const src = source("src/app/actions/recruiter-profile-actions.ts");
  const action = src.slice(src.indexOf("export async function uploadCompanyLogoAction"));
  const update = action.indexOf("prisma.organization.update");
  const del = action.indexOf("deleteCompanyLogoBlob");
  assert(update > 0 && del > 0, "both the update and the delete must be present");
  assert(
    update < del,
    "a row pointing at a deleted blob is a broken image; a stale blob is not",
  );
});

suite("removeCompanyLogoAction clears the column and is workspace-scoped", () => {
  const src = source("src/app/actions/recruiter-profile-actions.ts");
  const action = src.slice(src.indexOf("export async function removeCompanyLogoAction"));
  assert(
    action.includes("await requireRecruiterWorkspace()"),
    "remove must resolve the workspace server-side",
  );
  assert(action.includes("logoUrl: null"), "remove must null the column");
});

suite("the profile read returns the logo", () => {
  const src = source("src/app/actions/recruiter-profile-actions.ts");
  assert(src.includes("logoUrl: true"), "the org select must include logoUrl");
  assert(
    src.includes("logoUrl: org?.logoUrl ?? null"),
    "the details payload must carry logoUrl",
  );
});

suite("the settings form renders the logo control and degrades when unconfigured", () => {
  const page = source("src/app/hire/settings/page.tsx");
  assert(
    page.includes("logoUploadAvailable={isCompanyLogoStorageConfigured()}"),
    "the page must resolve storage availability on the server",
  );
  const form = source("src/components/hire/recruiter-profile-form.tsx");
  assert(form.includes("Company Logo"), "the form must label the control");
  assert(
    form.includes("Logo upload is unavailable right now."),
    "a missing env var must read as a temporary gap, not a missing feature",
  );
  assert(
    !form.includes("org-logo-storage"),
    "a client component must never import the server-only storage module",
  );
});

suite("the logo buttons cannot submit the surrounding profile form", () => {
  const form = source("src/components/hire/recruiter-profile-form.tsx");
  const block = form.slice(
    form.indexOf('className="hire-logo"'),
    form.indexOf('htmlFor="companyName"'),
  );
  const buttons = block.split("<button").length - 1;
  const typed = block.split('type="button"').length - 1;
  assert(buttons >= 1, "the logo block must render buttons");
  assert(
    typed >= buttons,
    `${buttons} logo buttons but ${typed} type="button" — these sit inside the ` +
      "profile <form>, so a default-submit button would save on every click",
  );
});

suite("the logo is fitted, not centre-cropped, and keeps its alpha", () => {
  const form = source("src/components/hire/recruiter-profile-form.tsx");
  assert(form.includes('"image/png"'), "export PNG — JPEG would black out alpha");
  assert(
    !form.includes("squareJpeg"),
    "the avatar's centre-crop would cut a non-square logo",
  );
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
