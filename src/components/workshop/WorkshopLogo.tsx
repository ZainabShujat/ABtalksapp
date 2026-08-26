import Image from "next/image";
import Link from "next/link";

export default function WorkshopLogo() {
  return (
    <Link
      href="/"
      aria-label="ABTalks home"
      className="wk-logo logo-link group relative inline-flex shrink-0 overflow-hidden rounded-md"
    >
      <style>{`
        .wk-logo::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.5) 50%, transparent 60%);
          transform: translateX(-130%) skewX(-15deg);
          pointer-events: none;
        }
        .wk-logo:hover::after { animation: wk-logo-shine 0.75s ease forwards; }
        @keyframes wk-logo-shine { to { transform: translateX(130%) skewX(-15deg); } }
        .wk-logo img { transition: filter 0.3s ease, transform 0.3s ease; }
        /* The source PNG is white. globals.css inverts it to dark for light
           mode, but this header bar is charcoal in BOTH themes, so keep the
           native white. Three-class specificity so it beats the dark-mode
           rule in globals.css without depending on stylesheet order. */
        .wk-root .wk-logo .logo-image { filter: none; }
        .wk-root .wk-logo:hover .logo-image {
          filter: drop-shadow(0 0 10px rgba(var(--wk-a1-rgb),0.55));
        }
        .wk-logo:hover img { transform: scale(1.03); }
      `}</style>
      <Image
        src="/abtalks-logo.png"
        alt="ABTalks"
        width={300}
        height={84}
        priority
        className="logo-image !h-6 w-auto sm:!h-7"
      />
    </Link>
  );
}
