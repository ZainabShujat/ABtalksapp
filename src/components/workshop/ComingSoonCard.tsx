export default function ComingSoonCard() {
  return (
    <div
      className="wk-soon relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl px-5 py-8 text-center"
      style={{ background: "rgba(255,255,255,0.015)" }}
    >
      <style>{`
        .wk-soon {
          border: 1.5px dashed rgba(255,255,255,0.14);
        }
        .wk-soon::before {
          content: "";
          position: absolute;
          top: -40%;
          left: -40%;
          width: 180%;
          height: 180%;
          background: radial-gradient(circle at center, rgba(var(--wk-a2-rgb),0.10), transparent 55%);
          animation: wk-soon-orbit 9s linear infinite;
          pointer-events: none;
        }
        @keyframes wk-soon-orbit {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes wk-soon-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%           { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes wk-soon-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50%      { transform: translateY(-6px) rotate(8deg); }
        }
        .wk-soon-emoji { animation: wk-soon-float 4s ease-in-out infinite; }
        .wk-soon-dot { animation: wk-soon-bounce 1.4s ease-in-out infinite; }
      `}</style>

      <span className="wk-soon-emoji relative z-10 text-4xl">✨</span>

      <h4 className="relative z-10 mt-3 text-[17px] font-bold tracking-tight text-white">
        More Coming Soon
      </h4>
      <p className="relative z-10 mt-2 max-w-[240px] text-[12.5px] font-medium leading-relaxed text-white/45">
        New live workshops drop regularly. Register above to be the first to know.
      </p>

      {/* animated dots */}
      <div className="relative z-10 mt-4 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="wk-soon-dot h-1.5 w-1.5 rounded-full"
            style={{
              background: "var(--wk-grad)",
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>

      <span
        className="relative z-10 mt-5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
        style={{
          background: "rgba(255,255,255,0.04)",
          color: "rgba(255,255,255,0.5)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        Stay tuned
      </span>
    </div>
  );
}
