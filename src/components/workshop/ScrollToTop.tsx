"use client";

export default function ScrollToTop() {
  return (
    <button
      onClick={() => {
        document
          .getElementById("register")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className="cursor-pointer rounded-full px-9 py-3.5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5"
      style={{
        background: "var(--wk-grad)",
        boxShadow:
          "0 10px 30px -8px rgba(var(--wk-a2-rgb),0.6), inset 0 1px 0 rgba(255,255,255,0.25)",
      }}
    >
      Reserve Your Free Seat →
    </button>
  );
}
