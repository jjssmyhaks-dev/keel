import { db } from "../src/lib/db";
import { currentIdentityDocument, issueIdentityDocumentSafe } from "../src/lib/identity-document";

async function main() {
  const agents = await db.agent.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  let issued = 0;
  let skipped = 0;

  for (const agent of agents) {
    if (await currentIdentityDocument(agent.id)) {
      skipped += 1;
      continue;
    }
    await issueIdentityDocumentSafe(agent.id);
    const current = await currentIdentityDocument(agent.id);
    if (current) {
      issued += 1;
      console.log(`issued doc #${current.docSeq} for ${agent.name} (${agent.id})`);
    } else {
      console.error(`failed to issue a document for ${agent.name} (${agent.id})`);
      process.exitCode = 1;
    }
  }

  console.log(`Backfill complete: ${issued} issued, ${skipped} current, ${agents.length} agents.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
