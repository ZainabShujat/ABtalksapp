/**
 * Curated dialing-code list for the VideoThon registration form.
 *
 * Hand-curated rather than pulling in libphonenumber-js (~55 KB gzipped
 * minimum) — the form only needs a country-code picker for display + storage,
 * not full parsing/validation of every country's local number format.
 *
 * The list covers India first (the primary audience), then every other country
 * with a meaningful chance of showing up. Alphabetized by ISO code within each
 * group for stable ordering. If someone needs a code that isn't here, they can
 * tell the organizers and we add one line — the DB stores raw
 * `phoneCountryCode` strings, so this list is display-only.
 */

export type PhoneCountry = {
  /** ISO 3166-1 alpha-2. Used as React key. */
  iso: string;
  /** Country display name shown in the select. */
  name: string;
  /** Dial code including the plus sign, e.g. "+91". Stored on the row. */
  dial: string;
};

export const PHONE_COUNTRIES: PhoneCountry[] = [
  // Primary audience.
  { iso: "IN", name: "India", dial: "+91" },

  // Everyone else, alphabetized by ISO. Global coverage without being a
  // 240-item wall — pull requests welcome for anything missing.
  { iso: "AE", name: "United Arab Emirates", dial: "+971" },
  { iso: "AR", name: "Argentina", dial: "+54" },
  { iso: "AT", name: "Austria", dial: "+43" },
  { iso: "AU", name: "Australia", dial: "+61" },
  { iso: "BD", name: "Bangladesh", dial: "+880" },
  { iso: "BE", name: "Belgium", dial: "+32" },
  { iso: "BR", name: "Brazil", dial: "+55" },
  { iso: "CA", name: "Canada", dial: "+1" },
  { iso: "CH", name: "Switzerland", dial: "+41" },
  { iso: "CN", name: "China", dial: "+86" },
  { iso: "CZ", name: "Czechia", dial: "+420" },
  { iso: "DE", name: "Germany", dial: "+49" },
  { iso: "DK", name: "Denmark", dial: "+45" },
  { iso: "EG", name: "Egypt", dial: "+20" },
  { iso: "ES", name: "Spain", dial: "+34" },
  { iso: "FI", name: "Finland", dial: "+358" },
  { iso: "FR", name: "France", dial: "+33" },
  { iso: "GB", name: "United Kingdom", dial: "+44" },
  { iso: "GR", name: "Greece", dial: "+30" },
  { iso: "HK", name: "Hong Kong", dial: "+852" },
  { iso: "ID", name: "Indonesia", dial: "+62" },
  { iso: "IE", name: "Ireland", dial: "+353" },
  { iso: "IL", name: "Israel", dial: "+972" },
  { iso: "IT", name: "Italy", dial: "+39" },
  { iso: "JP", name: "Japan", dial: "+81" },
  { iso: "KE", name: "Kenya", dial: "+254" },
  { iso: "KR", name: "South Korea", dial: "+82" },
  { iso: "LK", name: "Sri Lanka", dial: "+94" },
  { iso: "MX", name: "Mexico", dial: "+52" },
  { iso: "MY", name: "Malaysia", dial: "+60" },
  { iso: "NG", name: "Nigeria", dial: "+234" },
  { iso: "NL", name: "Netherlands", dial: "+31" },
  { iso: "NO", name: "Norway", dial: "+47" },
  { iso: "NP", name: "Nepal", dial: "+977" },
  { iso: "NZ", name: "New Zealand", dial: "+64" },
  { iso: "PH", name: "Philippines", dial: "+63" },
  { iso: "PK", name: "Pakistan", dial: "+92" },
  { iso: "PL", name: "Poland", dial: "+48" },
  { iso: "PT", name: "Portugal", dial: "+351" },
  { iso: "QA", name: "Qatar", dial: "+974" },
  { iso: "RO", name: "Romania", dial: "+40" },
  { iso: "RU", name: "Russia", dial: "+7" },
  { iso: "SA", name: "Saudi Arabia", dial: "+966" },
  { iso: "SE", name: "Sweden", dial: "+46" },
  { iso: "SG", name: "Singapore", dial: "+65" },
  { iso: "TH", name: "Thailand", dial: "+66" },
  { iso: "TR", name: "Turkey", dial: "+90" },
  { iso: "TW", name: "Taiwan", dial: "+886" },
  { iso: "UA", name: "Ukraine", dial: "+380" },
  { iso: "US", name: "United States", dial: "+1" },
  { iso: "VN", name: "Vietnam", dial: "+84" },
  { iso: "ZA", name: "South Africa", dial: "+27" },
];

/**
 * The set of dial codes the server will accept. Trims to just the values
 * from the display list — anything else the client somehow sends is rejected
 * by the Zod schema. Kept as a Set for O(1) lookup on the hot path.
 */
export const ACCEPTED_DIAL_CODES: ReadonlySet<string> = new Set(
  PHONE_COUNTRIES.map((c) => c.dial),
);
