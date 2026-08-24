import Link from "next/link";
import { FOOTER_COLUMNS } from "./landing-content";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <span className="footer__logo">AB TALKS</span>
        </div>

        {FOOTER_COLUMNS.map((col) => (
          <nav className="footer__col" aria-label={col.title} key={col.title}>
            <h3 className="footer__head">{col.title}</h3>
            <ul>
              {col.links.map((link) => (
                <li key={link.href + link.label}>
                  {link.href.startsWith("#") ? (
                    <a href={link.href}>{link.label}</a>
                  ) : (
                    <Link href={link.href}>{link.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="container footer__legal">
        <span>ABTalks © {year}</span>
        <span>Profiles are shared only with candidate consent.</span>
      </div>
    </footer>
  );
}
