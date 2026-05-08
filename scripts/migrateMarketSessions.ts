import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Map symbols from 'market timings.csv' to their names in the 'instruments' table
const SYMBOL_MAPPING: Record<string, string> = {
    'GER40': 'DE30',
    'HK50': 'HKG50',
    'JPN225': 'JP225',
    'NAS100': 'US100',
    'SPX500': 'US500',
    'UKOUSD': 'UKOil',
    'USOUSD': 'USOil'
};

async function main() {
    const csvPath = path.join(__dirname, '../../docs/market timings.csv');
    console.log(`🚀 Starting Market Sessions migration...`);
    console.log(`Reading CSV from: ${csvPath}`);

    if (!fs.existsSync(csvPath)) {
        throw new Error(`Could not find CSV file at ${csvPath}`);
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // Skip the header row
    const dataLines = lines.slice(1);
    console.log(`Found ${dataLines.length} records to process.`);

    let successCount = 0;
    let failCount = 0;

    for (const line of dataLines) {
        // CSV structure: id,symbol,instrument,dayOfWeek,openTime,closeTime,timeZone,isActive
        const parts = line.split(',');

        let symbol = parts[1]?.trim();
        const dayOfWeekStr = parts[3]?.trim();
        let openTime = parts[4]?.trim();
        let closeTime = parts[5]?.trim();
        const timezone = parts[6]?.trim() || 'UTC';
        let isActive = parts[7]?.trim() === '1';

        // Validation
        if (!symbol || dayOfWeekStr === undefined || dayOfWeekStr === '') {
            continue;
        }

        // Apply symbol mapping
        if (SYMBOL_MAPPING[symbol]) {
            symbol = SYMBOL_MAPPING[symbol];
        }

        const dayOfWeek = parseInt(dayOfWeekStr, 10);

        // Handle missing times (e.g., weekends)
        if (!openTime || !closeTime) {
            // If times are missing, the market is closed that day
            openTime = "00:00";
            closeTime = "00:00";
            isActive = false;
        }

        // Format times: HH:MM:SS -> HH:MM
        const formattedOpen = openTime.substring(0, 5);
        const formattedClose = closeTime.substring(0, 5);

        try {
            await prisma.marketSession.upsert({
                where: {
                    symbol_dayOfWeek: {
                        symbol,
                        dayOfWeek,
                    },
                },
                update: {
                    openTime: formattedOpen,
                    closeTime: formattedClose,
                    timezone,
                    isActive,
                },
                create: {
                    symbol,
                    dayOfWeek,
                    openTime: formattedOpen,
                    closeTime: formattedClose,
                    timezone,
                    isActive,
                },
            });
            successCount++;
            if (successCount % 100 === 0) console.log(`Processed ${successCount} sessions...`);
        } catch (err: any) {
            // Likely foreign key violation if instrument doesn't exist
            failCount++;
            console.error(`❌ Error migrating ${symbol} (Day ${dayOfWeek}): ${err.message.split('\n')[0]}`);
        }
    }

    console.log(`\n✨ Migration Summary:`);
    console.log(`- Successfully upserted: ${successCount}`);
    console.log(`- Failed: ${failCount}`);
    console.log('🎉 Completed.');
}

main()
    .catch(e => {
        console.error('Fatal Migration Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });


