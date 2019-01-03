
import * as lodash from 'lodash';
import sqlite from 'sqlite';
import * as ynab from 'ynab';


interface SmsRow {
    ROWID: number;
    text: string;
    date_: string;
}

interface Transaction {
    type: 'pos' | 'utalas' | 'allando' | 'csoportos' | 'hitel';
    value: number;
    balance: number;
    timestamp: string; // ex. 2018.12.24 12:39:06
    partner: string;
    message: string;
}

const BUDAPEST_BANK_SMS = ["+36303444770", "+36309266245"];
const SMS_QUERY = `
SELECT
    rowid,
    text,
    datetime(date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') as date_
FROM message
WHERE
    handle_id in
        (SELECT rowid from handle WHERE id in
            (${BUDAPEST_BANK_SMS.map(x => '"' + x + '"').join(', ')})
        )
    AND date_ >= date(?)
ORDER BY date ASC
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
    ],
    [
        /^HUF fizetési szàmla \([0-9]+\) esedékes (hitel\/ tartozàs|kamat) törlesztve ([0-9 ]+)Ft ([0-9\.]+) E: ([0-9 ]+)Ft Közl: (.*)$/,
        (parts: Array<string>) => ({
            type: 'hitel',
            value: -1 * parseNumber(parts[2]),
            partner: 'Budapest Bank',
            timestamp: parts[3],
            balance: parseNumber(parts[4]),
            message: parts[1],
        })
    ]
];

const SIKERTELEN = /^Sikertelen Visa Prémium POS/;

function shouldSkip(text: string): boolean {
    return SIKERTELEN.test(text);
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

function getBudgetByName(api: ynab.API, budgetName: string): Promise<ynab.BudgetSummary> {
    return api.budgets.getBudgets()
        .then(resp => {
            const b = resp.data.budgets.find(b => b.name == budgetName)
            if (b != null) {
                return b;
            } else {
                throw Error("Cannot find budget with name: " + budgetName);
            }
        })
}

function getAccountByName(api: ynab.API, budgetPromise: Promise<ynab.BudgetSummary>, accountName: string): Promise<ynab.Account> {
    return budgetPromise
        .then(budget => api.accounts.getAccounts(budget.id))
        .then(resp => {
            const a = resp.data.accounts.find(a => a.name == accountName);
            if (a == null) {
                throw Error("Cannot find account with name: " + accountName);
            }
            return a;
        })
}

function querySms(startingDate: string): Promise<Array<Transaction>> {
    return sqlite.open('/Users/laszlopandy/Library/Messages/chat.db', { mode: 1 /* read only */ })
        .then(db => {
            return db.all(SMS_QUERY, startingDate)
                .then((rows: Array<SmsRow>) => {
                    const transactions = rows.map(processRow).filter(x => x != null) as Array<Transaction>;
                    db.close();
                    return transactions;
                })
        });
}

function isCleared(t: ynab.TransactionSummary): boolean {
    return t.cleared == ynab.TransactionDetail.ClearedEnum.Cleared || t.cleared == ynab.TransactionDetail.ClearedEnum.Reconciled;
}

function main() {


    const ynabToken = process.argv[2];
    const budgetName = process.argv[3];
    const accountName = process.argv[4];

    const api = new ynab.API(ynabToken);

    const budgetPromise = getBudgetByName(api, budgetName);
    const accountPromise = getAccountByName(api, budgetPromise, accountName);

    Promise.all([ budgetPromise, accountPromise ])
        .then(([ budget, account ]) => {
            return api.transactions.getTransactionsByAccount(budget.id, account.id)
                .then((resp: ynab.TransactionsResponse): [ ynab.BudgetSummary, ynab.Account, Array<ynab.TransactionDetail> ] => {
                    return [ budget, account, resp.data.transactions ];
                });
        })
        .then(([ budget, account, transactions ]) => {
            const trs = lodash.filter(transactions, isCleared)
            let latestDate = lodash.max(trs.map(t => t.date));
            if (latestDate == null) {
                latestDate = "2001-01-01";
            }
            const latestDayOfTransactions = lodash.filter(trs, t => t.date === latestDate);

            return querySms(latestDate)
                .then((smsTrs: Array<Transaction>) => {
                    // TODO: remove all SMS transactions which have match in YNAB. Use cleared account balance to verify.
                    const transactions = smsTrs.map((tr: Transaction): ynab.SaveTransaction => {
                        return {
                            account_id: account.id,
                            date: "",
                            amount: tr.value * 1000,
                            payee_name: tr.partner,
                            memo: tr.message,
                            cleared: ynab.TransactionDetail.ClearedEnum.Cleared,
                            approved: true,
                            import_id: "BB-SMS:" + tr.timestamp,
                        };
                    });
                    return api.transactions.bulkCreateTransactions(budget.id, { transactions });
                })
        })
        .catch(reason => {
            console.log("ERROR: " + reason);
        });
}

if (require.main === module) {
    main();
}