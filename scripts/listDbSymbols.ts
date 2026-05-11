import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const instruments = await prisma.instrument.findMany({
        select: { symbol: true }
    });
    console.log('Symbols in DB:', instruments.length);
    console.log(JSON.stringify(instruments.map(i => i.symbol).sort(), null, 2));
}

main().finally(() => prisma.$disconnect());
