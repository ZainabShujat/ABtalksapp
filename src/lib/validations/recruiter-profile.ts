import { z } from "zod";

/**
 * International phone number validation matching the repository convention.
 * Accepts:
 *   - Optional leading + sign
 *   - 7 to 15 digits (E.164 spec range)
 *   - Spaces, hyphens, or parentheses for formatting
 *
 * Rejects:
 *   - Letters or invalid symbols (e.g. '=', 'u', 'i', '@')
 *   - Fewer than 7 digits or more than 15 digits
 */
export function isValidRecruiterPhone(val: string | null | undefined): boolean {
  if (!val || val.trim().length === 0) return true;
  const trimmed = val.trim();
  // Disallow any characters other than +, digits, spaces, hyphens, and parentheses
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) {
    return false;
  }
  // Disallow duplicate + or + in the middle
  if ((trimmed.match(/\+/g) || []).length > 1 || (trimmed.includes("+") && !trimmed.startsWith("+"))) {
    return false;
  }
  // Check total digit count (7 to 15 digits)
  const rawDigits = trimmed.replace(/\D/g, "");
  return rawDigits.length >= 7 && rawDigits.length <= 15;
}

const optionalNullableString = (maxLen: number, label: string) =>
  z
    .string()
    .trim()
    .max(maxLen, `${label} cannot exceed ${maxLen} characters.`)
    .optional()
    .nullable()
    .transform((val) => {
      if (!val || val.trim().length === 0) return null;
      return val.trim();
    });

/**
 * A person's name carries no digits. Written as a REJECTION of digits rather
 * than a whitelist of allowed characters: a whitelist would have to enumerate
 * every script, accent, apostrophe, hyphen and particle a real name can hold,
 * and every such list eventually rejects somebody's actual name. `\p{Nd}`
 * covers every Unicode decimal digit, not just 0-9, so a name padded with
 * Devanagari or Arabic-Indic numerals is caught the same way "Sarthak123" is.
 */
const NAME_HAS_DIGIT = /\p{Nd}/u;

export const updateRecruiterProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(100, "Full name cannot exceed 100 characters.")
    .refine(
      (v) => !NAME_HAS_DIGIT.test(v),
      "Full name cannot contain numbers.",
    ),

  phone: z
    .string()
    .trim()
    .max(25, "Phone number cannot exceed 25 characters.")
    .optional()
    .nullable()
    .transform((val) => {
      if (!val || val.trim().length === 0) return null;
      return val.trim();
    })
    .refine(
      (val) => isValidRecruiterPhone(val),
      "Enter a valid phone number (7-15 digits, optional + prefix).",
    ),

  companyName: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters.")
    .max(120, "Company name cannot exceed 120 characters."),

  website: z
    .string()
    .trim()
    .max(200, "Website URL cannot exceed 200 characters.")
    .optional()
    .nullable()
    .transform((val) => {
      if (!val || val.trim().length === 0) return null;
      const trimmed = val.trim();
      if (!/^https?:\/\//i.test(trimmed)) {
        return `https://${trimmed}`;
      }
      return trimmed;
    })
    .refine((val) => {
      if (val === null) return true;
      try {
        const u = new URL(val);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    }, "Please enter a valid website URL."),

  industry: optionalNullableString(80, "Industry"),
  companySize: optionalNullableString(40, "Company size"),
  location: optionalNullableString(120, "Location"),
});

export type UpdateRecruiterProfileInput = z.infer<
  typeof updateRecruiterProfileSchema
>;

export type RecruiterProfileDetails = {
  fullName: string;
  phone: string | null;
  email: string;
  companyName: string;
  website: string | null;
  industry: string | null;
  companySize: string | null;
  location: string | null;
  /**
   * The company logo (plan 158). Read-only as far as this schema is concerned:
   * it is absent from `updateRecruiterProfileSchema` on purpose, so the only
   * value that can ever reach `Organization.logoUrl` is a blob URL the upload
   * action itself got back from storage — never text a client sent.
   */
  logoUrl: string | null;
};

/** 2 MB, the same ceiling as a candidate avatar. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * SVG is excluded deliberately: it is a script-bearing document format and the
 * logo store is public. PNG and WebP cover transparent logos, which is the only
 * thing SVG would have been wanted for here.
 */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

export function isAllowedLogoMimeType(value: string): value is LogoMimeType {
  return (LOGO_MIME_TYPES as readonly string[]).includes(value);
}
