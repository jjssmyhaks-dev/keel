import type { Metadata } from "next";
import { Navigation } from "@/components/landing/navigation";
import { HeroSection } from "@/components/landing/hero-section";
import { CapabilitiesSection } from "@/components/landing/capabilities-section";
import { ProcessSection } from "@/components/landing/process-section";
import { PolicyDemo } from "@/components/landing/policy-demo";
import { RuntimeSection } from "@/components/landing/runtime-section";
import { ConnectorsSection } from "@/components/landing/connectors-section";
import { SecuritySection } from "@/components/landing/security-section";
import { DevelopersSection } from "@/components/landing/developers-section";
import { MetricsSection } from "@/components/landing/metrics-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { CtaSection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";
import { demoLoginEnabled } from "@/lib/demo";

export const metadata: Metadata = {
  title: "Authab — Identity, vault and governance for AI agents",
  description:
    "Give every AI agent a short-lived cryptographic identity, a vault it can use but never read, and permissions a human approved.",
};

export default function LandingPage() {
  return (
    <main className="relative">
      <Navigation overlay />
      <HeroSection />
      <CapabilitiesSection />
      <ProcessSection />
      <PolicyDemo />
      <RuntimeSection />
      <ConnectorsSection />
      <SecuritySection />
      <DevelopersSection />
      <MetricsSection />
      <PricingSection />
      <CtaSection demoEnabled={demoLoginEnabled()} />
      <FooterSection />
    </main>
  );
}
