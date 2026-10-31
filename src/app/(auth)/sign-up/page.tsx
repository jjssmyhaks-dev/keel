import type { Metadata } from "next";
import { configuredProviders } from "@/lib/oauth";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; next?: string }>;
}) {
  const { plan, next } = await searchParams;
  return <SignUpForm plan={plan} next={next} providers={configuredProviders()} />;
}
