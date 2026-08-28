"use client";

import Image from "next/image";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { EASE_SPARK, useSafeReducedMotion } from "@/lib/motion";

const PHOTOS = [
  "/landing/community/photo-1.png",
  "/landing/community/photo-2.png",
  "/landing/community/photo-3.png",
  "/landing/community/photo-4.png",
  "/landing/community/photo-4.png",
] as const;

const AVATARS = [
  "/landing/community/avatar-1.png",
  "/landing/community/avatar-2.png",
  "/landing/community/avatar-3.png",
  "/landing/community/avatar-4.png",
] as const;

export function CommunityCollage() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduce = useSafeReducedMotion();
  const show = reduce || inView;

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gap: 12,
        minHeight: 280,
      }}
      className="hub-collage"
    >
      {PHOTOS.map((src, i) => (
        <motion.div
          key={`${src}-${i}`}
          initial={reduce ? false : { opacity: 0, y: 36, scale: 0.96 }}
          animate={
            show
              ? { opacity: 1, y: 0, scale: 1 }
              : { opacity: 0, y: 36, scale: 0.96 }
          }
          transition={{
            duration: 0.55,
            delay: reduce ? 0 : i * 0.1,
            ease: EASE_SPARK,
          }}
          style={{
            position: "relative",
            borderRadius: 16,
            overflow: "hidden",
            aspectRatio: "9 / 16",
            background: "#e8e8ee",
          }}
        >
          <Image
            src={src}
            alt=""
            fill
            sizes="(max-width: 900px) 40vw, 12vw"
            className="hub-collage-photo"
          />
        </motion.div>
      ))}

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{
          duration: 0.5,
          delay: reduce ? 0 : 0.55,
          ease: EASE_SPARK,
        }}
        style={{
          position: "absolute",
          right: 8,
          bottom: 12,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 10px 10px rgba(0,0,0,0.2)",
          padding: "14px 16px",
          width: 220,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 800,
            color: "var(--hub-accent)",
          }}
        >
          10,000+
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 8,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "#666" }}>
            Active Builders
          </span>
          <span style={{ display: "flex" }}>
            {AVATARS.map((src, i) => (
              <span
                key={src}
                style={{
                  position: "relative",
                  width: 24,
                  height: 24,
                  marginLeft: i === 0 ? 0 : -8,
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid #fff",
                }}
              >
                <Image src={src} alt="" fill sizes="24px" />
              </span>
            ))}
          </span>
        </div>
      </motion.div>

      <style>{`
        @media (max-width: 700px) {
          .hub-collage { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .hub-collage > div:nth-child(4),
          .hub-collage > div:nth-child(5) { display: none; }
        }
      `}</style>
    </div>
  );
}
