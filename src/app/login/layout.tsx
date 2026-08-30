/**
 * Login stays visually light regardless of the root next-themes preference.
 * Nested `forcedTheme` does not reliably clear `html.dark`, so the page
 * uses `.theme-abtalks-light` CSS tokens instead (see page.tsx).
 */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
