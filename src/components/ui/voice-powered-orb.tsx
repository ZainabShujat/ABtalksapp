"use client";

import { useEffect, useRef, type FC, type RefObject } from "react";
import { Renderer, Program, Mesh, Triangle, Vec3 } from "ogl";
import type { OGLRenderingContext } from "ogl";
import { cn } from "@/lib/utils";

/**
 * A WebGL orb that visualises an audio level supplied by its parent.
 *
 * Adapted from the shared VoicePoweredOrb. The shader is unchanged; the audio
 * lifecycle is not.
 *
 * The original opened its OWN microphone via `getUserMedia` and built its own
 * AudioContext and AnalyserNode. That is wrong inside the interview for three
 * reasons: it would raise a second permission prompt, it would run a second
 * capture alongside the one MediaRecorder is already using for speech-to-text,
 * and it forced `echoCancellation`/`noiseSuppression`/`autoGainControl` off,
 * which is good for a pretty waveform and bad for transcription accuracy.
 *
 * So this component owns no audio at all. It reads a number from a ref that the
 * interview room fills from the single analyser it already runs. Level is read
 * inside the render loop and written straight to a shader uniform, so a 60fps
 * signal never passes through React state.
 */

export type OrbMode = "idle" | "speaking" | "listening" | "processing";

interface VoicePoweredOrbProps {
  className?: string;
  hue?: number;
  /**
   * Live 0..1 audio level. Read every frame, never subscribed to.
   * Ignored unless `mode` is "listening" — the orb must not react to the
   * candidate's microphone while the interviewer is talking.
   */
  levelRef?: RefObject<number>;
  mode?: OrbMode;
  voiceSensitivity?: number;
  maxRotationSpeed?: number;
  maxHoverIntensity?: number;
}

const vert = /* glsl */ `
  precision highp float;
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform float iTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float hover;
  uniform float rot;
  uniform float hoverIntensity;
  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) {
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    float i = dot(c, vec3(0.596, -0.274, -0.322));
    float q = dot(c, vec3(0.211, -0.523, 0.312));
    return vec3(y, i, q);
  }

  vec3 yiq2rgb(vec3 c) {
    float r = c.x + 0.956 * c.y + 0.621 * c.z;
    float g = c.x - 0.272 * c.y - 0.647 * c.z;
    float b = c.x - 1.106 * c.y + 1.703 * c.z;
    return vec3(r, g, b);
  }

  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = hueDeg * 3.14159265 / 180.0;
    vec3 yiq = rgb2yiq(color);
    float cosA = cos(hueRad);
    float sinA = sin(hueRad);
    float i = yiq.y * cosA - yiq.z * sinA;
    float q = yiq.y * sinA + yiq.z * cosA;
    yiq.y = i;
    yiq.z = q;
    return yiq2rgb(yiq);
  }

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(
      p3.x + p3.y,
      p3.x + p3.z,
      p3.y + p3.z
    ) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(
      dot(d0, d0),
      dot(d1, d1),
      dot(d2, d2),
      dot(d3, d3)
    ), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  const vec3 baseColor1 = vec3(0.878431, 0.321569, 0.149020);
  const vec3 baseColor2 = vec3(1.000000, 0.686275, 0.513725);
  const vec3 baseColor3 = vec3(0.788235, 0.254902, 0.109804);
  const float innerRadius = 0.6;
  const float noiseScale = 0.65;

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }

  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3 color1 = adjustHue(baseColor1, hue);
    vec3 color2 = adjustHue(baseColor2, hue);
    vec3 color3 = adjustHue(baseColor3, hue);

    float ang = atan(uv.y, uv.x);
    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;

    float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0, 10.0, d0);
    v0 *= smoothstep(r0 * 1.05, r0, len);
    float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

    float a = iTime * -1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = light2(1.5, 5.0, d);
    v1 *= light1(1.0, 50.0, d0);

    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col = mix(color1, color2, cl);
    col = mix(color3, col, v0);
    col = (col + v1) * v2 * v3;
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  vec4 mainImage(vec2 fragCoord) {
    vec2 center = iResolution.xy * 0.5;
    float size = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord - center) / size * 2.0;

    float angle = rot;
    float s = sin(angle);
    float c = cos(angle);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
    uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

    return draw(uv);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution.xy;
    vec4 col = mainImage(fragCoord);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`;

/** Per-mode resting motion, before any live audio is added. */
const MODE_BASE: Record<OrbMode, { rotation: number; hover: number }> = {
  // Almost still. Present, not asking for attention.
  idle: { rotation: 0.08, hover: 0.05 },
  // The interviewer talking: a steady, self-driven motion. Deliberately NOT
  // wired to the microphone, so the orb cannot appear to react to the candidate
  // while it is the interviewer's turn.
  speaking: { rotation: 0.34, hover: 0.34 },
  // The candidate has the floor: a calm floor that their voice adds to.
  listening: { rotation: 0.14, hover: 0.1 },
  // Thinking. Slower than idle, so a pause reads as consideration.
  processing: { rotation: 0.05, hover: 0.16 },
};

export const VoicePoweredOrb: FC<VoicePoweredOrbProps> = ({
  className,
  hue = 0,
  levelRef,
  mode = "idle",
  voiceSensitivity = 1.4,
  maxRotationSpeed = 1.1,
  maxHoverIntensity = 0.7,
}) => {
  const ctnDom = useRef<HTMLDivElement>(null);
  // Mode is mirrored into a ref so a mode change never restarts the WebGL
  // context — remounting the renderer on every phase transition would flash.
  const modeRef = useRef<OrbMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const container = ctnDom.current;
    if (!container) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let renderer: Renderer | null = null;
    let gl: OGLRenderingContext | null = null;
    let program: Program | null = null;
    let rafId = 0;

    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        dpr: window.devicePixelRatio || 1,
      });
      gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(gl.canvas as HTMLCanvasElement);

      const geometry = new Triangle(gl);
      program = new Program(gl, {
        vertex: vert,
        fragment: frag,
        uniforms: {
          iTime: { value: 0 },
          iResolution: {
            value: new Vec3(
              gl.canvas.width,
              gl.canvas.height,
              gl.canvas.width / gl.canvas.height,
            ),
          },
          hue: { value: hue },
          hover: { value: 0 },
          rot: { value: 0 },
          hoverIntensity: { value: 0 },
        },
      });

      const mesh = new Mesh(gl, { geometry, program });

      const resize = () => {
        if (!container || !renderer || !gl) return;
        const dpr = window.devicePixelRatio || 1;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === 0 || height === 0) return;
        renderer.setSize(width * dpr, height * dpr);
        gl.canvas.style.width = `${width}px`;
        gl.canvas.style.height = `${height}px`;
        program?.uniforms.iResolution.value.set(
          gl.canvas.width,
          gl.canvas.height,
          gl.canvas.width / gl.canvas.height,
        );
      };
      window.addEventListener("resize", resize);
      resize();

      // Reduced motion: draw one frame and stop. The orb stays on screen as a
      // static presence; state is conveyed by the room's text label instead.
      if (reduceMotion) {
        program.uniforms.hover.value = 0.1;
        program.uniforms.hoverIntensity.value = 0.05;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        renderer.render({ scene: mesh });
        return () => {
          window.removeEventListener("resize", resize);
          gl?.getExtension("WEBGL_lose_context")?.loseContext();
        };
      }

      let lastTime = 0;
      let currentRot = 0;
      // Smoothed level. The raw analyser signal is jittery enough that feeding
      // it straight to a uniform makes the orb twitch on consonants; easing
      // toward the target gives the "settles when they stop" behaviour without
      // a second filter in the audio path.
      let smoothed = 0;

      const update = (t: number) => {
        rafId = requestAnimationFrame(update);
        if (!program || !renderer || !gl) return;

        const dt = Math.min((t - lastTime) * 0.001, 0.1);
        lastTime = t;
        program.uniforms.iTime.value = t * 0.001;
        program.uniforms.hue.value = hue;

        const currentMode = modeRef.current;
        const base = MODE_BASE[currentMode];

        // Microphone level is honoured ONLY while the candidate has the floor.
        const target =
          currentMode === "listening"
            ? Math.min((levelRef?.current ?? 0) * voiceSensitivity, 1)
            : 0;

        // Rise fast, fall slow: speech should register immediately and decay
        // gently, which is what reads as "organic" rather than as a meter.
        const ease = target > smoothed ? 0.35 : 0.06;
        smoothed += (target - smoothed) * ease;

        currentRot += dt * (base.rotation + smoothed * maxRotationSpeed);
        program.uniforms.rot.value = currentRot;
        program.uniforms.hover.value = Math.min(base.hover + smoothed * 1.4, 1);
        program.uniforms.hoverIntensity.value = Math.min(
          base.hover * 0.5 + smoothed * maxHoverIntensity,
          maxHoverIntensity,
        );

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        renderer.render({ scene: mesh });
      };

      rafId = requestAnimationFrame(update);

      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", resize);
        const canvas = gl?.canvas as HTMLCanvasElement | undefined;
        if (container && canvas && container.contains(canvas)) {
          try {
            container.removeChild(canvas);
          } catch {
            // The container may already be gone during unmount; nothing to do.
          }
        }
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      };
    } catch {
      // WebGL unavailable (blocked, software rendering disabled, headless).
      // The interview must still run, so the orb simply renders nothing.
      return () => {};
    }
    // The renderer is built once. `mode` and the audio level are read through
    // refs inside the loop, so neither belongs in this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hue, voiceSensitivity, maxRotationSpeed, maxHoverIntensity]);

  return (
    <div ref={ctnDom} className={cn("relative h-full w-full", className)} />
  );
};
