import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.group.findMany();
  console.log("Groups in DB:", groups.map(g => g.name));
}

main().catch(console.error).finally(() => prisma.$disconnect());
