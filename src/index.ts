
import sqlite from 'sqlite';

const QUERY = `
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

const POS_REGEX = /^Visa Prémium POS tranzakciò ([0-9 ]+)Ft Idöpont: ([0-9\.]+) (?:[0-9:]+) E: ([0-9 ]+)Ft Hely: (.+)$/;
const UTALAS_REGEX = /^HUF fizetési szàmla \([0-9]+\) utalàs érkezett ([0-9 ]+)Ft ([0-9\.]+) E: ([0-9 ]+)Ft Küldö: (.*) Közl: (.*)$/;

interface SmsRow {
    ROWID: number;
    text: string;
    date_: string;
}

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


function main() {
    sqlite.open('/Users/laszlopandy/Library/Messages/chat.db')
        .then(db => {
            db.each(QUERY, (_, row: SmsRow) => {
                if (row != null && row.text != null) {
                    let parts;
                    if ((parts = POS_REGEX.exec(row.text)) != null) {
                        // console.log(parts);
                        const value = parseNumber(parts[1])
                        const timestamp = parts[2];
                        const balance = parseNumber(parts[3]);
                        const place = fixHungarian(parts[4]);
                        //console.log({ type: "pos", value, timestamp, balance, place });
                    } else if ((parts = UTALAS_REGEX.exec(row.text)) != null) {
                        const value = parseNumber(parts[1])
                        const timestamp = parts[2];
                        const balance = parseNumber(parts[3]);
                        const sender = parts[4];
                        const message = parts[5];
                        //console.log({ type: "utalas", value, timestamp, balance, sender, message });
                    } else {
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