import { PrismaClient, CommissionType, CommissionValueType, SwapType, MarginCalcMode, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function cleanDecimal(val: string): string {
    if (!val || val.trim() === '') return '0';
    const trimmed = val.trim();
    const parts = trimmed.split('.');
    if (parts.length > 2) {
        return parts[0] + '.' + parts.slice(1).join('');
    }
    if (trimmed.startsWith('.')) return '0' + trimmed;
    if (trimmed.startsWith('-.')) return '-0.' + trimmed.substring(2);
    return trimmed;
}

const groupMapping: Record<string, string> = {
    'standard group.csv': 'Standard',
    'classic group.csv': 'Classic',
    'ECN group.csv': 'ECN',
    'Elite group.csv': 'Elite',
    'royal group.csv': 'Royal+',
    'VIP group.csv': 'VIP'
};

const commTypeMap: Record<string, CommissionType> = {
    '0': 'round_turn',
    '1': 'entry_only',
    '2': 'exit_only'
};

const commValueTypeMap: Record<string, CommissionValueType> = {
    '0': 'per_lot',
    '1': 'percentage'
};

async function migrateFile(fileName: string, groupId: string) {
    const csvPath = path.join(__dirname, '../../docs', fileName);
    if (!fs.existsSync(csvPath)) {
        console.warn(`⚠️  Skipping ${fileName}: File not found.`);
        return;
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0).slice(1);

    console.log(`📊 Migrating ${lines.length} symbols for ${groupMapping[fileName]}...`);

    const dataToInsert = [];

    for (const line of lines) {
        const parts = line.split(',');
        const [id, gid, symbol, spreadType, spread, spreadPip, maxSpread, swapBuy, swapSell, swapType, commission, commissionType, commissionValueType, marginPct, marginCalcMode, marginFactor, minLot, maxLot, lotStep, deviation, bonus, isTradable] = parts;

        if (!symbol) continue;

        dataToInsert.push({
            groupId,
            symbol: symbol.trim(),
            spreadType: spreadType?.trim() || 'fixed',
            spread: new Prisma.Decimal(cleanDecimal(spread)),
            spreadPip: new Prisma.Decimal(cleanDecimal(spreadPip)),
            maxSpread: maxSpread ? new Prisma.Decimal(cleanDecimal(maxSpread)) : null,
            swapBuy: new Prisma.Decimal(cleanDecimal(swapBuy)),
            swapSell: new Prisma.Decimal(cleanDecimal(swapSell)),
            swapType: (swapType?.trim() as SwapType) || 'points',
            commission: new Prisma.Decimal(cleanDecimal(commission)),
            commissionType: commTypeMap[commissionType] || 'round_turn',
            commissionValueType: commValueTypeMap[commissionValueType] || 'per_lot',
            marginPct: new Prisma.Decimal(cleanDecimal(marginPct)),
            marginCalcMode: (marginCalcMode?.trim() as MarginCalcMode) || 'standard',
            marginFactor: new Prisma.Decimal(cleanDecimal(marginFactor)),
            minLot: new Prisma.Decimal(cleanDecimal(minLot)),
            maxLot: new Prisma.Decimal(cleanDecimal(maxLot)),
            lotStep: new Prisma.Decimal(cleanDecimal(lotStep)),
            deviation: new Prisma.Decimal(cleanDecimal(deviation)),
            bonus: new Prisma.Decimal(cleanDecimal(bonus)),
            isTradable: isTradable === '1',
        });
    }

    if (dataToInsert.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < dataToInsert.length; i += CHUNK_SIZE) {
            const chunk = dataToInsert.slice(i, i + CHUNK_SIZE);
            await prisma.groupSymbol.createMany({
                data: chunk,
                skipDuplicates: true,
            });
        }
    }
}

async function main() {
    console.log('🗑️  Clearing all existing GroupSymbol entries...');
    await prisma.groupSymbol.deleteMany();

    const groups = await prisma.group.findMany();
    const groupNameToId = new Map(groups.map(g => [g.name, g.id]));

    for (const [fileName, groupName] of Object.entries(groupMapping)) {
        const groupId = groupNameToId.get(groupName);
        if (!groupId) continue;
        await migrateFile(fileName, groupId);
    }

    console.log('🎉 Group Symbols migration completed.');
}

main()
    .catch(e => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
