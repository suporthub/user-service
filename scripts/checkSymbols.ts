import * as fs from 'fs';
import * as path from 'path';

const symbolsCsv = fs.readFileSync(path.join(__dirname, '../../docs/Symbols.csv'), 'utf-8');
const symbols = new Set(symbolsCsv.split('\n').slice(1).map(l => l.split(',')[1]?.trim()).filter(Boolean));

const groupFiles = [
    'standard group.csv',
    'classic group.csv',
    'ECN group.csv',
    'Elite group.csv',
    'royal group.csv',
    'VIP group.csv'
];

for (const file of groupFiles) {
    console.log(`\nChecking ${file}...`);
    const groupCsv = fs.readFileSync(path.join(__dirname, '../../docs', file), 'utf-8');
    const groupSymbols = groupCsv.split('\n').slice(1).map(l => l.split(',')[2]?.trim()).filter(Boolean);
    for (const s of groupSymbols) {
        if (!symbols.has(s)) {
            console.log(`Missing symbol in ${file}: "${s}"`);
        }
    }
}
