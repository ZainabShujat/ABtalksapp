"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { uploadAvatarAction } from "@/app/actions/candidate-profile-actions";

const MAX_CLIENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function squareJpeg(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not prepare the photo."));
        return;
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("Could not prepare the photo."));
          else resolve(blob);
        },
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

export function AvatarEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (
      file.type === "image/svg+xml" ||
      name.endsWith(".svg") ||
      !ALLOWED_TYPES.has(file.type)
    ) {
      toast.error("Please choose a JPEG, PNG, or WebP photo.");
      return;
    }
    if (file.size > MAX_CLIENT_BYTES) {
      toast.error("That file is too large. Please choose a photo under 2 MB.");
      return;
    }

    setPending(true);
    try {
      const blob = await squareJpeg(file);
      const prepared = new File([blob], "avatar.jpg", { type: "image/jpeg" });
      const form = new FormData();
      form.set("file", prepared);
      const result = await uploadAvatarAction(form);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not upload the photo.",
      );
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <button
        type="button"
        className="pw-avatar-edit"
        aria-label="Change profile photo"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? (
          <span className="pw-avatar-spin" aria-hidden />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
            />
          </svg>
        )}
      </button>
      <input
        ref={inputRef}
        className="pw-photo-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={pending}
        onChange={(event) => void onPick(event.target.files?.[0])}
      />
    </>
  );
}
