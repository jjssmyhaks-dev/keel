import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  handleApiError,
  requireSecretKey,
} from "@/lib/api";
import { CONSENT_TOKEN_TTL_SECONDS, mintConsentToken } from "@/lib/consent";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const existing = await db.consent.findFirst({
      where: { id, projectId: auth.project.id },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "consent_not_found", "No consent with that ID exists.");

    const minted = await mintConsentToken(existing.id);
    return apiOk({
      agentToken: minted.issued.token,
      expiresIn: CONSENT_TOKEN_TTL_SECONDS,
      consentId: minted.consent.id,
      endUserId: minted.endUser.id,
      scopes: minted.scopes,
      expiresAt: minted.consent.expiresAt?.toISOString() ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
