
import sqlite from 'sqlite';


interface SmsRow {
    ROWID: number;
    text: string;
    date_: string;
}

interface Transaction {
    type: 'pos' | 'utalas' | 'allando' | 'csoportos';
    value: number;
    balance: number;
    timestamp: string; // ex. 2018.12.24 12:39:06
    partner: string;
    message: string;
}

const SMS_QUERY = `
SELECT
    rowid,
    text,
    datetime(date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') as date_
FROM message
WHERE
    handle_id in
        (SELECT rowid from handle WHERE id in  ("+36303444770", "+36309266245"))
    AND date_ >= date("2018-11-28")
ORDER BY date DESC
`

function parseNumber(str: string): number {
    return parseInt(str.replace(/\s/g, ""));
}

function titleCase(str: string): string {
    return str.split(' ')
        .map(w => w[0].toUpperCase() + w.substr(1).toLowerCase())
        .join(' ');
}

function fixHungarian(str: string): string {
    // áéíóú öü őű
    return str
        .replace(/a'/g, 'á').replace(/A'/g, 'Á')
        .replace(/e'/g, 'é').replace(/E'/g, 'É')
        .replace(/i'/g, 'í').replace(/I'/g, 'Í')
        .replace(/o'/g, 'ó').replace(/O'/g, 'Ó')
        .replace(/u'/g, 'ú').replace(/U'/g, 'Ú')
        .replace(/o:/g, 'ö').replace(/O:/g, 'Ö')
        .replace(/u:/g, 'ü').replace(/U:/g, 'Ü')
        .replace(/o"/g, 'ő').replace(/O"/g, 'Ő')
        .replace(/u"/g, 'ű').replace(/U"/g, 'Ű');
}

const SMS_REGEX: Array<[ RegExp, (parts: Array<string>) => Transaction ]> = [
    [
        /^Visa Prémium POS tranzakciò ([0-9 ]+)Ft Idöpont: ([0-9\.]+) (?:[0-9:]+) E: ([0-9 ]+)Ft Hely: (.+)$/,
        (parts: Array<string>) => ({
            type: 'pos',
            value: -1 * parseNumber(parts[1]),
            timestamp: parts[2],
            balance: parseNumber(parts[3]),
            partner: fixHungarian(parts[4]),
            message: ""
        })
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) utalàs érkezett ([0-9 ]+)Ft ([0-9\.]+) E: ([0-9 ]+)Ft Küldö: (.*) Közl: (.*)$/,
        (parts: Array<string>) => ({
            type: 'utalas',
            value: parseNumber(parts[1]),
            timestamp: parts[2],
            balance: parseNumber(parts[3]),
            partner: parts[4],
            message: parts[5],
        })
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) àllandò utalàsi megbìzàs teljesült ([0-9 ]+)Ft ([0-9\.]+) E: ([0-9 ]+)Ft Kedv.: (.*) Közl: (.*)$/,
        (parts: Array<string>) => ({
            type: 'allando',
            value: -1 * parseNumber(parts[1]),
            timestamp: parts[2],
            balance: parseNumber(parts[3]),
            partner: parts[4],
            message: parts[5],
        })
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) közüzemi megbìzàsa teljesült: (.*?) ([0-9 ]+)Ft Kedv.: (.*) ([0-9\.]+) E: ([0-9 ]+)Ft(?: Közl: (.*))?$/,
        (parts: Array<string>) => ({
            type: 'csoportos',
            value: -1 * parseNumber(parts[2]),
            partner: parts[3],
            timestamp: parts[4],
            balance: parseNumber(parts[5]),
            message: parts[1] + (parts.length > 6 ? " " + parts[6] : ""),
        })
    ]
];

function main() {
    sqlite.open('/Users/laszlopandy/Library/Messages/chat.db')
        .then(db => {
            db.each(SMS_QUERY, (_, row: SmsRow) => {
                if (row != null && row.text != null) {
                    let item = null;
                    for (const [regex, func] of SMS_REGEX) {
                        const parts = regex.exec(row.text);
                        if (parts != null) {
                            item = func(parts);
                            //console.log(item);
                            break;
                        }
                    }

                    if (item == null) {
                        console.log("ERROR cannot match", row.text);
                    }
                }
            });
        })
        .catch(err => {
            console.log(err);
        });
}

if (require.main === module) {
    main();
}