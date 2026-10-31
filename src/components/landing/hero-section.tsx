"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { HeroVisual } from "./hero-visual";

const words = ["passwords", "raw API keys", "secrets", "bearer tokens"];

function BlurWord({ word, trigger }: { word: string; trigger: number }) {
  const letters = word.split("");
  const STAGGER = 30;
  const DURATION = 460;
  const HOLD = STAGGER * letters.length + DURATION + 900;

  const [states, setStates] = useState(() => letters.map(() => ({ opacity: 0, blur: 16 })));
  const [gradient, setGradient] = useState(true);
  const frames = useRef<number[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    frames.current.forEach(cancelAnimationFrame);
    timers.current.forEach(clearTimeout);
    frames.current = [];
    timers.current = [];

    setStates(letters.map(() => ({ opacity: 0, blur: 16 })));
    setGradient(true);

    letters.forEach((_, i) => {
      const timer = setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / DURATION, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setStates((prev) => {
            const next = [...prev];
            next[i] = { opacity: eased, blur: 16 * (1 - eased) };
            return next;
          });
          if (progress < 1) frames.current.push(requestAnimationFrame(tick));
        };
        frames.current.push(requestAnimationFrame(tick));
      }, i * STAGGER);
      timers.current.push(timer);
    });

    const settle = setTimeout(() => setGradient(false), HOLD);
    timers.current.push(settle);
    return () => {
      frames.current.forEach(cancelAnimationFrame);
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const colors = ["#eca8d6", "#c4b5fd", "#f9a8d4", "#fcd34d", "#eca8d6"];

  return (
    <span className="whitespace-nowrap">
      {letters.map((char, i) => {
        const pos = (i / Math.max(letters.length - 1, 1)) * (colors.length - 1);
        const lower = Math.floor(pos);
        const upper = Math.min(lower + 1, colors.length - 1);
        const mix = pos - lower;
        const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        const a = hex(colors[lower]);
        const b = hex(colors[upper]);
        const rgb = a.map((v, k) => Math.round(v + (b[k] - v) * mix));
        return (
          <span
            key={`${char}-${i}`}
            style={{
              display: "inline-block",
              opacity: states[i]?.opacity ?? 0,
              filter: `blur(${states[i]?.blur ?? 16}px)`,
              color: gradient ? `rgb(${rgb.join(",")})` : "#fff",
              transition: "color .4s ease",
            }}
          >
            {char === " " ? "\u00A0" : char}
          </span>
        );
      })}
    </span>
  );
}

export function HeroSection() {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setVisible(true);
    const interval = setInterval(() => setIndex((v) => (v + 1) % words.length), 3200);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden bg-black text-white">
      <HeroVisual />

      <div className="absolute inset-0 z-[2] overflow-hidden pointer-events-none opacity-25">
        {[...Array(7)].map((_, i) => (
          <div key={`h${i}`} className="absolute h-px bg-white/[0.08]" style={{ top: `${14.28 * (i + 1)}%`, left: 0, right: 0 }} />
        ))}
        {[...Array(11)].map((_, i) => (
          <div key={`v${i}`} className="absolute w-px bg-white/[0.08]" style={{ left: `${9.09 * (i + 1)}%`, top: 0, bottom: 0 }} />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-[1400px] mx-auto px-6 lg:px-12 pt-28 pb-40">
        <div className="lg:max-w-[64%]">
          <div className={`mb-8 transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
            <span className="inline-flex items-center gap-3 text-[13px] font-mono text-white/55">
              <span className="w-8 h-px bg-white/30" />
              Identity infrastructure for AI agents
            </span>
          </div>

          <h1
            className={`text-[clamp(2.7rem,6.4vw,7.4rem)] font-display leading-[0.92] tracking-[-0.02em] text-white transition-all duration-1000 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <span className="block">Agents need</span>
            <span className="block mt-1">
              passports, not <BlurWord word={words[index]} trigger={index} />
            </span>
          </h1>

          <p
            className={`mt-10 max-w-xl text-lg lg:text-xl text-white/55 leading-relaxed transition-all duration-1000 delay-200 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            Keel gives every agent a short-lived cryptographic identity, a vault it can use
            but never read, and permissions a human approved. Go live without handing
            agents your keys.
          </p>

          <div
            className={`mt-10 flex flex-wrap items-center gap-4 transition-all duration-1000 delay-300 ${
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <Link
              href="/sign-up"
              className="group inline-flex items-center gap-2 h-13 px-7 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors"
            >
              Start building free
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/docs/quickstart"
              className="group inline-flex items-center gap-2 h-13 px-7 rounded-full border border-white/20 text-sm text-white/80 hover:text-white hover:border-white/40 transition-colors"
            >
              Read the quickstart
              <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className={`mt-12 flex items-center gap-2 font-mono text-[11px] text-white/35 transition-all duration-1000 delay-500 ${visible ? "opacity-100" : "opacity-0"}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#eca8d6] live-dot" />
            No credit card · Development mode free forever
          </div>
        </div>
      </div>

      <div
        className={`absolute bottom-10 left-0 right-0 px-6 lg:px-12 transition-all duration-1000 delay-700 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-start gap-10 lg:gap-24 border-t border-white/10 pt-8">
          {[
            { value: "5 min", label: "to your first authenticated call" },
            { value: "300s", label: "agent token lifetime, by default" },
            { value: "<50 ms", label: "policy + vault overhead at p95" },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col gap-1.5">
              <span className="text-2xl lg:text-4xl font-display text-white">{stat.value}</span>
              <span className="text-[11px] text-white/40 leading-tight max-w-[180px]">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
