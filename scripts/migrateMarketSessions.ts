import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    const csvPath = path.join(__dirname, '../../docs/market timings.csv');
    console.log(`Reading Market Sessions CSV from: ${csvPath}`);

    if (!fs.existsSync(csvPath)) {
        throw new Error(`Could not find CSV file at ${csvPath}`);
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(1);

    console.log('🗑️  Erasing existing market session data...');
    await prisma.marketSession.deleteMany();

    const dataToInsert = [];
    console.log(`🚀 Preparing ${lines.length} potential session records...`);

    for (const line of lines) {
        const parts = line.split(',');
        let [id, symbol, instrument, dayOfWeek, openTime, closeTime, timeZone, isActive] = parts;

        if (!symbol || symbol.trim() === '') continue;

        symbol = symbol.trim();
        if (symbol === 'GER30') symbol = 'GER40';

        if (!openTime || !closeTime || openTime.trim() === '' || closeTime.trim() === '') {
            continue;
        }

        dataToInsert.push({
            symbol,
            dayOfWeek: parseInt(dayOfWeek, 10),
            openTime: openTime.trim().substring(0, 5),
            closeTime: closeTime.trim().substring(0, 5),
            timezone: timeZone?.trim() || 'UTC',
            isActive: isActive === '1',
        });
    }

    if (dataToInsert.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < dataToInsert.length; i += CHUNK_SIZE) {
            const chunk = dataToInsert.slice(i, i + CHUNK_SIZE);
            await prisma.marketSession.createMany({
                data: chunk,
                skipDuplicates: true,
            });
            console.log(`✅ Progress: Migrated ${Math.min(i + CHUNK_SIZE, dataToInsert.length)} / ${dataToInsert.length} sessions...`);
        }
    }
    console.log('🎉 Market Sessions migration completed successfully.');
}

main()
    .catch(e => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
