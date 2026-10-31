"use client";

import { useEffect, useRef, useState } from "react";

const metrics = [
  { value: 0, label: "Secrets exposed to agent processes", sublabel: "by design, not by policy" },
  { value: 5, suffix: " min", label: "Default agent token lifetime", sublabel: "EdDSA, short-lived" },
  { value: 15, suffix: " s", label: "Upstream call timeout", sublabel: "failures surface fast" },
];

function AnimatedNumber({ end, prefix = "", suffix = "", decimals = 0 }: { end: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !done) {
        setDone(true);
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - start) / 2200, 1);
          const eased = 1 - Math.pow(1 - p, 4);
          setCount(end * eased);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, done]);

  const display =
    decimals > 0
      ? count.toFixed(2)
      : Math.floor(count).toLocaleString();

  return (
    <div ref={ref} className="inline-flex items-baseline tabular-nums">
      {prefix && <span className="text-muted-foreground mr-0.5">{prefix}</span>}
      <span>{display}</span>
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function DotGraph({ seed = 0, height = 32 }: { seed?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const time = useRef(seed * 40);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.offsetWidth || 300;
    const H = height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      const cols = Math.floor(W / 8);
      for (let i = 0; i < cols; i++) {
        const raw =
          0.42 +
          0.34 * Math.sin(i * 0.26 + time.current) * Math.cos(i * 0.08 + time.current * 0.55) +
          0.12 * Math.sin(i * 0.9 + time.current * 1.7);
        const v = Math.max(0.04, Math.min(1, raw));
        const y = H - 4 - v * (H - 8);
        const alpha = 0.12 + v * 0.6;
        ctx.beginPath();
        ctx.arc(i * 8 + 4, y, 1.4 + v * 1.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,0,0,${alpha})`;
        ctx.fill();
      }
      time.current += 0.018;
      frame.current = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame.current);
  }, [height]);

  return <canvas ref={ref} style={{ width: "100%", height }} />;
}

function GridBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let time = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      const size = 56;
      for (let x = 0; x < w; x += size) {
        for (let y = 0; y < h; y += size) {
          const wave = Math.sin(x * 0.012 + y * 0.012 + time) * 0.5 + 0.5;
          ctx.beginPath();
          ctx.arc(x, y, 1 + wave * 1.8, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,0,0,0.06)";
          ctx.fill();
        }
      }
      const py = (time * 26) % h;
      ctx.strokeStyle = "rgba(0,0,0,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
      time += 0.02;
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas ref={ref} className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }} />
  );
}

export function MetricsSection() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold: 0.1 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="relative py-24 lg:py-32 overflow-hidden">
      <GridBackdrop />
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-12 gap-8 mb-16">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-4 mb-6">
              <span className="flex items-center gap-2 px-3 py-1 bg-[#eca8d6]/15 text-[#8c3f72] text-[10px] font-mono uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-[#b0568f]" />
                by the numbers
              </span>
            </div>
            <h2
              className={`text-6xl md:text-7xl lg:text-[112px] font-display tracking-tight leading-[0.92] transition-all duration-1000 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              Quietly
              <br />
              <span className="text-muted-foreground">observable.</span>
            </h2>
          </div>
          <div className="lg:col-span-4 flex items-end">
            <p className="text-lg text-muted-foreground leading-relaxed">
              Usage, latency and denials are visible per agent, per connector and per
              environment — not buried in a gateway dashboard you have to build.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {metrics.map((metric, i) => (
            <div
              key={metric.label}
              className={`border border-foreground/10 bg-background/80 p-8 lg:p-10 transition-all duration-700 ${
                i === 0 ? "lg:col-span-1" : ""
              } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
              style={{ transitionDelay: `${i * 90}ms` }}
            >
              <div className="text-4xl md:text-5xl font-display tracking-tight mb-5 whitespace-nowrap">
                <AnimatedNumber
                  end={metric.value}
                  suffix={metric.suffix}
                  decimals={metric.suffix === "%" ? 2 : 0}
                />
              </div>
              <div className="mb-6">
                <DotGraph seed={i} height={30} />
              </div>
              <div className="text-base mb-1">{metric.label}</div>
              <div className="text-xs text-muted-foreground font-mono">{metric.sublabel}</div>
            </div>
          ))}
        </div>

        <div
          className={`mt-16 pt-8 border-t border-foreground/10 flex flex-wrap items-center gap-x-12 gap-y-4 text-[11px] font-mono text-muted-foreground transition-all duration-1000 delay-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <span>proxy.calls</span>
          <span>policy.decisions</span>
          <span>approval.decisions</span>
          <span>audit.events</span>
        </div>
      </div>
    </section>
  );
}
