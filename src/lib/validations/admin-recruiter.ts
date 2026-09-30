import { z } from "zod";
import {
  PASSWORD_IS_EMAIL_MESSAGE,
  passwordIsNotEmail,
  passwordSchema,
} from "@/lib/validations/email-auth";
import { updateRecruiterProfileSchema } from "@/lib/validations/recruiter-profile";
import { workEmailSchema } from "@/lib/validations/work-email";

/**
 * Admin-created recruiter accounts (plan 159).
 *
 * Built by extending `updateRecruiterProfileSchema` rather than restating its
 * fields: full name (no digits), phone, company name, website (auto-`https://`),
 * industry, size and location already have reviewed rules there, and an admin
 * form that quietly accepted looser ones would be a second source of truth.
 *
 * `logoUrl` is deliberately absent, for the same reason it is absent from the
 * schema this extends (plan 158): a logo arrives as a file and is written only
 * from a blob URL the server produced, never from text.
 *
 * `email` is `workEmailSchema` with **no** admin override. See
 * `src/lib/validations/work-email.ts`: the rule holds "on any path", and an
 * admin form is exactly the exception mechanism T-225 removed.
 */
export const createRecruiterSchema = updateRecruiterProfileSchema
  .extend({
    email: workEmailSchema,
    /** `generate` issues one server-side; `manual` takes the admin's. */
    passwordMode: z.enum(["generate", "manual"]),
    password: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.passwordMode !== "manual") return;

    const parsed = passwordSchema.safeParse(value.password ?? "");
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: parsed.error.issues[0]?.message ?? "Enter a password.",
      });
      return;
    }
    if (!passwordIsNotEmail(value.email, parsed.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: PASSWORD_IS_EMAIL_MESSAGE,
      });
    }
  });

export type CreateRecruiterInput = z.infer<typeof createRecruiterSchema>;
