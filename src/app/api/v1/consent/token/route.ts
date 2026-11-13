import { db } from "@/lib/db";
import {
  ApiError,
  apiOk,
  authenticateApiKey,
  handleApiError,
  parseJson,
  requireSecretKey,
} from "@/lib/api";
import { CONSENT_TOKEN_TTL_SECONDS, consentIsActive, mintConsentToken } from "@/lib/consent";
import { sha256 } from "@/lib/crypto";

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const body = await parseJson<{ code?: string; redirectUri?: string }>(req);
    const code = body.code?.trim();
    const redirectUri = body.redirectUri?.trim();
    if (!code) throw new ApiError(422, "invalid_code", "Provide the one-time code from the consent redirect.");
    if (!redirectUri) throw new ApiError(422, "redirect_mismatch", "Provide the redirectUri used for the request.");

    const request = await db.consentRequest.findFirst({
      where: { codeHash: sha256(code), projectId: auth.project.id },
    });
    if (!request) throw new ApiError(422, "invalid_code", "This code is not valid.");
    if (request.status === "exchanged") {
      throw new ApiError(409, "code_used", "This code was already exchanged. Start a new consent request.");
    }
    if (request.redirectUri !== redirectUri) {
      throw new ApiError(422, "redirect_mismatch", "redirectUri does not match the one used to create the request.");
    }
    if (request.status !== "approved" || !request.consentId) {
      throw new ApiError(409, "invalid_code", "This consent request was not approved.");
    }
    if (!request.codeExpiresAt || request.codeExpiresAt <= new Date()) {
      throw new ApiError(409, "code_expired", "This code expired. The end user must approve again.");
    }

    const consent = await db.consent.findUnique({ where: { id: request.consentId } });
    if (!consent || !consentIsActive(consent)) {
      throw new ApiError(409, "consent_inactive", "This consent was revoked or expired before the code was used.");
    }

    const claimed = await db.consentRequest.updateMany({
      where: { id: request.id, status: "approved" },
      data: { status: "exchanged", completedAt: new Date() },
    });
    if (!claimed.count) {
      throw new ApiError(409, "code_used", "This code was already exchanged. Start a new consent request.");
    }

    const minted = await mintConsentToken(request.consentId);
    return apiOk({
      agentToken: minted.issued.token,
      expiresIn: CONSENT_TOKEN_TTL_SECONDS,
      consentId: minted.consent.id,
      endUserId: minted.endUser.id,
      scopes: minted.scopes,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
