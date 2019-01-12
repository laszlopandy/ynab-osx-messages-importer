
import * as fs from 'fs';
import * as lodash from 'lodash';
import * as path from 'path';
import sqlite from 'sqlite';
import * as ynab from 'ynab';
import { findByName, getBudgetAccountsTransactions, isCleared } from './helpers';


interface SmsRow {
    ROWID: number;
    text: string;
    date_: string;
}

interface Transaction {
    type: 'pos' | 'atm' | 'incoming-transfer' | 'outgoing-transfer' | 'csoportos' | 'hitel';
    value: number;
    balance: number;
    date: string;
    partner: string;
    memo: string;
    time?: string;
}

interface AccountNames {
    card: string;
    cash: string;
}

type Accounts = {
    [P in keyof AccountNames]: ynab.Account;
}

interface Config {
    ynab_token: string;
    budget_name: string;
    primary_account_name: string;
    cash_account_name: string;
    bank_sms_numbers: Array<string>;
}

function parseNumber(str: string): number {
    return parseInt(str.replace(/\s/g, ""));
}

function convertDate(str: string): string {
    return str.replace(/\./g, "-");
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
        /^Visa Prémium POS tranzakciò ([0-9 ]+)Ft Idöpont: ([0-9\.]+) ([0-9:]+) E: ([0-9 ]+)Ft Hely: (.+)$/,
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
        /^Visa Prémium ATM tranzakciò ([0-9 ]+)Ft Idöpont: ([0-9\.]+) ([0-9:]+) E: ([0-9 ]+)Ft Hely: (.+)$/,
        (parts: Array<string>) => ({
            type: 'atm',
            value: -1 * parseNumber(parts[1]),
            date: convertDate(parts[2]),
            balance: parseNumber(parts[4]),
            partner: 'cash',
            time: parts[3],
            memo: fixHungarian(parts[5]),
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
    ]
];

const SIKERTELEN = /^Sikertelen Visa Prémium POS/;

function shouldSkip(text: string): boolean {
    return SIKERTELEN.test(text);
}

function makeQuery(bankSmsNumbers: Array<string>): string {
    if (!bankSmsNumbers.every(n => /^\+[0-9]+$/.test(n))) {
        throw new Error("Bank SMS numbers must start with '+' and be followed only by numbers.");
    }

    const clause = bankSmsNumbers.map(x => '"' + x + '"').join(', ')
    return `
SELECT
    rowid,
    text,
    datetime(date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') as date_
FROM message
WHERE
    handle_id in
        (SELECT rowid from handle WHERE id in (${clause}))
    AND date_ >= date(?)
ORDER BY date ASC
`

}

function processRow(row: SmsRow): Transaction | null {
    let item = null;
    if (row != null && row.text != null && !shouldSkip(row.text)) {
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

    return item;
}

async function querySms(bankSmsNumbers: Array<string>, startingDate: string): Promise<Array<Transaction>> {
    const home = process.env['HOME'];
    if (home == null) {
        throw new Error("Cannot locate iMessage database (no HOME in env)");
    }

    const query = makeQuery(bankSmsNumbers);

    const db = await sqlite.open(path.join(home, 'Library/Messages/chat.db'), { mode: 1 /* read only */ });
    const rows: Array<SmsRow> = await db.all(query, startingDate);
    const transactions = rows.map(processRow).filter(x => x != null) as Array<Transaction>;
    db.close();

    return transactions;
}

function createTransaction(accounts: Accounts, tr: Transaction): ynab.SaveTransaction {

    const base = {
        account_id: accounts.card.id,
        date: tr.date,
        amount: tr.value * 1000,
        cleared: ynab.TransactionDetail.ClearedEnum.Cleared,
        import_id: "BB-SMS-:" + tr.date + ":" + tr.value + ":" + tr.balance,
        approved: true,
        memo: tr.memo,
    };

    if (tr.type === 'atm') {
        return {
            ...base,
            payee_id: accounts.cash.transfer_payee_id,
        }
    } else {
        return {
            ...base,
            payee_name: tr.partner,
        };
    }
}

function main() {
    const config: Config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

    console.log("Connecting to YNAB");

    const api = new ynab.API(config.ynab_token);

    getBudgetAccountsTransactions(api, config.budget_name, config.primary_account_name)
        .then(([ budget, accounts, transactions ]) => {
            const trs = lodash.filter(transactions, isCleared)
            let latestDate = lodash.max(trs.map(t => t.date));
            if (latestDate == null) {
                latestDate = "2001-01-01";
            }

            console.log("Querying all SMS messages since " + latestDate);

            return querySms(config.bank_sms_numbers, latestDate)
                .then((smsTrs: Array<Transaction>) => {
                    const accountPair = {
                        cash: findByName(accounts, config.cash_account_name),
                        card: findByName(accounts, config.primary_account_name),
                    };
                    const transactions = smsTrs.map(tr => createTransaction(accountPair, tr));

                    console.log(`Ready to import ${transactions.length} transactions:`);
                    transactions.forEach(tr => console.log(tr));
                    console.log("");

                    return api.transactions.bulkCreateTransactions(budget.id, { transactions });
                })
                .then(resp => {
                    const bulk = resp.data.bulk;
                    console.log(`Successfully imported ${bulk.transaction_ids.length} transactions (${bulk.duplicate_import_ids.length} duplicates)`);
                });
        })
        .catch(reason => {
            const message = (reason instanceof Error) ? reason.toString() : "Error:" + JSON.stringify(reason);
            console.log(message);
        });
}

if (require.main === module) {
    main();
}