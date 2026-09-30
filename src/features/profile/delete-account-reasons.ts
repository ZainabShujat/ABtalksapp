/**
 * "Why are you leaving?" options on the self-delete dialog. Shared by the
 * client dialog and the server action's Zod schema, so it must stay free of
 * server-only imports.
 */
export const DELETE_ACCOUNT_REASONS = [
  "Found a job / internship",
  "Not useful for me",
  "Too many emails / notifications",
  "Privacy concerns",
  "Created a duplicate account",
  "Other",
] as const;

export type DeleteAccountReason = (typeof DELETE_ACCOUNT_REASONS)[number];

export const DELETE_ACCOUNT_FEEDBACK_MAX = 500;
