
import * as fs from 'fs';
import * as lodash from 'lodash';
import * as path from 'path';
import sqlite from 'sqlite';
import * as ynab from 'ynab';
import { CASH_WITHDRAWAL_PARTNER, Transaction, BankParser, SmsParser, logError } from './common';
import { findByName, getBudgetAccountsTransactions, isCleared } from './helpers/ynab';
import { getBudapestBank } from './sms-parsing/budapest-bank';


interface SmsRow {
    ROWID: number;
    text: string;
    date_: string;
}

interface Config {
    ynab_token: string;
    budget_name: string;
    sms_account_name: string;
    cash_account_name: string;
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

function processRow(smsParsers: Array<SmsParser>, row: SmsRow): Transaction | null {
    if (row == null || row.text == null) {
        throw Error("Query returned a null row")
    } else {
        for (const [regex, func] of smsParsers) {
            const parts = regex.exec(row.text);
            if (parts != null) {
                return func(parts);
            }
        }

        throw Error("Cannot match SMS: " + row.text);
    }
}

async function querySms(bank: BankParser, startingDate: string): Promise<Array<Transaction>> {
    const home = process.env['HOME'];
    if (home == null) {
        throw new Error("Cannot locate iMessage database (no HOME in env)");
    }

    const query = makeQuery(bank.smsNumbers);

    const db = await sqlite.open(path.join(home, 'Library/Messages/chat.db'), { mode: 1 /* read only */ });
    const rows: Array<SmsRow> = await db.all(query, startingDate);
    const transactions = rows.map(r => processRow(bank.smsParsers, r)).filter(x => x != null) as Array<Transaction>;
    db.close();

    return transactions;
}

function createTransaction(smsAccount: ynab.Account, cashAccount: ynab.Account, tr: Transaction): ynab.SaveTransaction {

    const base = {
        account_id: smsAccount.id,
        date: tr.date,
        amount: tr.value * 1000,
        cleared: ynab.TransactionDetail.ClearedEnum.Cleared,
        import_id: "BB-SMS-:" + tr.date + ":" + tr.value + ":" + tr.balance,
        approved: true,
        memo: tr.memo,
    };

    if (tr.partner === CASH_WITHDRAWAL_PARTNER) {
        return {
            ...base,
            payee_id: cashAccount.transfer_payee_id,
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

    getBudgetAccountsTransactions(api, config.budget_name, config.sms_account_name)
        .then(([ budget, accounts, transactions ]) => {
            const trs = lodash.filter(transactions, isCleared)
            let latestDate = lodash.max(trs.map(t => t.date));
            if (latestDate == null) {
                latestDate = "2001-01-01";
            }

            console.log("Querying all SMS messages since " + latestDate);

            return querySms(getBudapestBank(), latestDate)
                .then((smsTrs: Array<Transaction>) => {
                    const cashAccount = findByName(accounts, config.cash_account_name);
                    const smsAccount = findByName(accounts, config.sms_account_name);
                    const transactions = smsTrs.map(tr => createTransaction(smsAccount, cashAccount, tr));

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
        .catch(logError);
}

if (require.main === module) {
    main();
}