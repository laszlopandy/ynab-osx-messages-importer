import { SmsParser, CASH_WITHDRAWAL_PARTNER, BankParser } from '../common';


function parseNumber(str: string): number {
    return parseInt(str.replace(/\s/g, ""));
}

function convertDate(str: string): string {
    return str.replace(/\./g, "-");
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

const SMS_REGEX: Array<SmsParser> = [
    [
        /^Visa Prémium(?: Kàrtya)? POS tranzakciò ([0-9 ]+)Ft Idöpont: ([0-9\.]+) ([0-9:]+) E: ([0-9 ]+)Ft Hely: (.+)$/,
        (parts: Array<string>) => ({
            type: 'pos',
            value: -1 * parseNumber(parts[1]),
            date: convertDate(parts[2]),
            balance: parseNumber(parts[4]),
            partner: fixHungarian(parts[5]),
            time: parts[3],
            memo: "",
        })
    ],
    [
        /^Visa Prémium(?: Kàrtya)? ATM tranzakciò ([0-9 ]+)Ft Idöpont: ([0-9\.]+) ([0-9:]+) E: ([0-9 ]+)Ft Hely: (.+)$/,
        (parts: Array<string>) => ({
            type: 'atm',
            value: -1 * parseNumber(parts[1]),
            date: convertDate(parts[2]),
            balance: parseNumber(parts[4]),
            partner: CASH_WITHDRAWAL_PARTNER,
            time: parts[3],
            memo: fixHungarian(parts[5]),
        })
    ],
    [
        /^Visa Prémium Kàrtya utòlagos jòvàiràs ([0-9 ]+)Ft Idöpont: ([0-9\.]+) ([0-9:]+) Hely: (.+) E: ([0-9 ]+)Ft$/,
        (parts: Array<string>) => ({
            type: 'incoming-pos',
            value: parseNumber(parts[1]),
            date: convertDate(parts[2]),
            balance: parseNumber(parts[5]),
            partner: fixHungarian(parts[4]),
            time: parts[3],
            memo: "",
        })
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) utalàs érkezett ([0-9 ]+)Ft ([0-9\.]+) E: ([0-9 ]+)Ft Küldö: (.*) Közl: (.*)$/,
        (parts: Array<string>) => ({
            type: 'incoming-transfer',
            value: parseNumber(parts[1]),
            date: convertDate(parts[2]),
            balance: parseNumber(parts[3]),
            partner: parts[4],
            memo: parts[5],
        })
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) (?:àllandò )?utalàsi megbìzàs teljesült ([0-9 ]+)Ft ([0-9\.]+) E: ([0-9 ]+)Ft Kedv.: (.*) Közl: (.*)$/,
        (parts: Array<string>) => ({
            type: 'outgoing-transfer',
            value: -1 * parseNumber(parts[1]),
            date: convertDate(parts[2]),
            balance: parseNumber(parts[3]),
            partner: parts[4],
            memo: parts[5],
        })
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) közüzemi megbìzàsa teljesült: (.*?) ([0-9 ]+)Ft Kedv.: (.*) ([0-9\.]+) E: ([0-9 ]+)Ft(?: Közl: (.*))?$/,
        (parts: Array<string>) => ({
            type: 'csoportos',
            value: -1 * parseNumber(parts[2]),
            partner: parts[3],
            date: convertDate(parts[4]),
            balance: parseNumber(parts[5]),
            memo: parts[1] + (parts[6] != null ? " " + parts[6] : ""),
        })
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) esedékes (hitel\/ tartozàs|kamat) törlesztve ([0-9 ]+)Ft ([0-9\.]+) E: ([0-9 ]+)Ft Közl: (.*)$/,
        (parts: Array<string>) => ({
            type: 'hitel',
            value: -1 * parseNumber(parts[2]),
            partner: 'Budapest Bank',
            date: convertDate(parts[3]),
            balance: parseNumber(parts[4]),
            memo: parts[1],
        })
    ],
    [
        /^Sikertelen Visa Prémium (Kàrtya )?POS/,
        () => null,
    ],
];

export function getBudapestBank(): BankParser {
    return {
        smsParsers: SMS_REGEX,
        smsNumbers: ["+36303444770", "+36309266245"],
    };
}