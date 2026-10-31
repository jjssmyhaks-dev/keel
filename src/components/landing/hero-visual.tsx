"use client";

import { useEffect, useRef, useCallback } from "react";

const CHARS = " .:-=+*#%@";

type Point = { x: number; y: number; z: number };

export function HeroVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const mouse = useRef({ x: 0.5, y: 0.5 });
  const time = useRef(0);

  const onMove = useCallback((e: MouseEvent) => {
    mouse.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    window.addEventListener("mousemove", onMove);

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect?.width || canvas.offsetWidth;
      height = rect?.height || canvas.offsetHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const points: Point[] = [];
    const SEG = 132;
    const TUBE = 14;
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < TUBE; j++) {
        const u = (i / SEG) * Math.PI * 2;
        const v = (j / TUBE) * Math.PI * 2;
        const p = 2;
        const q = 3;
        const r = 2 + Math.cos(q * u);
        const x = r * Math.cos(p * u);
        const y = r * Math.sin(p * u);
        const z = -Math.sin(q * u);
        const tr = 0.42;
        points.push({
          x: x + tr * Math.cos(p * u) * Math.cos(v),
          y: y + tr * Math.sin(p * u) * Math.cos(v),
          z: z + tr * Math.sin(v),
        });
      }
    }

    const rotate = (pt: Point, ax: number, ay: number, az: number): Point => {
      let { x, y, z } = pt;
      const cx = Math.cos(ax), sx = Math.sin(ax);
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      const cy = Math.cos(ay), sy = Math.sin(ay);
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      const cz = Math.cos(az), sz = Math.sin(az);
      return { x: x * cz - y * sz, y: x * sz + y * cz, z };
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const scale = Math.min(width, height) * 0.3;
      const t = time.current;
      const ax = t * 0.26 + (mouse.current.y - 0.5) * 0.4;
      const ay = t * 0.42 + (mouse.current.x - 0.5) * 0.5;
      const az = t * 0.12;

      const projected = points
        .map((pt) => {
          const r = rotate(pt, ax, ay, az);
          const factor = 5 / (5 + r.z);
          return { x: centerX + r.x * scale * factor, y: centerY + r.y * scale * factor, z: r.z };
        })
        .sort((a, b) => a.z - b.z);

      const size = Math.max(9, Math.min(width, height) * 0.017);
      ctx.font = `${size}px "JetBrains Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const p of projected) {
        const n = Math.max(0, Math.min(1, (p.z + 3.2) / 6.4));
        const char = CHARS[Math.floor(n * (CHARS.length - 1))];
        const alpha = 0.08 + n * 0.7;
        const pink = n > 0.62;
        ctx.fillStyle = pink
          ? `rgba(236,168,214,${alpha * 0.95})`
          : `rgba(255,255,255,${alpha * 0.55})`;
        ctx.fillText(char, p.x, p.y);
      }

      for (let i = 0; i < 26; i++) {
        const px = (Math.sin(t * 0.4 + i * 1.7) * 0.34 + 0.5) * width;
        const py = (Math.cos(t * 0.27 + i * 0.9) * 0.34 + 0.5) * height;
        ctx.fillStyle = `rgba(236,168,214,${0.08 + (Math.sin(t + i) * 0.5 + 0.5) * 0.22})`;
        ctx.font = `${size * 0.9}px "JetBrains Mono", monospace`;
        ctx.fillText(CHARS[Math.floor((Math.sin(t + i) * 0.5 + 0.5) * 9)], px, py);
      }

      time.current += 0.006;
      frame.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame.current);
    };
  }, [onMove]);

  return (
    <div className="absolute inset-y-0 right-0 w-full lg:w-[58%] pointer-events-none overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40" />
    </div>
  );
}
