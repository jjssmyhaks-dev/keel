"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/session";

export async function switchAccountAction(formData: FormData) {
  const token = String(formData.get("token") || "");
  await destroySession();
  redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
}
