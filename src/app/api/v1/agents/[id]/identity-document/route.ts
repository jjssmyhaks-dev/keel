import { db } from "@/lib/db";
import { ApiError, apiOk, authenticateApiKey, handleApiError, requireSecretKey } from "@/lib/api";
import { currentIdentityDocument, issueIdentityDocumentSafe } from "@/lib/identity-document";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req);
    requireSecretKey(auth);
    const { id } = await ctx.params;
    const agent = await db.agent.findFirst({
      where: { id, environmentId: auth.environment.id },
      select: { id: true },
    });
    if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");

    let current = await currentIdentityDocument(agent.id);
    if (!current) {
      // Backfill on first read so an agent created before this feature still
      // has a verifiable document.
      await issueIdentityDocumentSafe(agent.id);
      current = await currentIdentityDocument(agent.id);
    }
    if (!current) {
      throw new ApiError(503, "identity_document_unavailable", "The identity document could not be issued. Try again.");
    }

    return apiOk({
      agentId: agent.id,
      docSeq: current.docSeq,
      document: JSON.parse(current.documentJson),
      jws: current.jws,
      issuerKeyId: current.issuerKeyId,
      issuedAt: current.issuedAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
