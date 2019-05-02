
import * as ynab from 'ynab';
import * as lodash from 'lodash';
import { isCleared } from './ynab';
import { getRate } from './transferwise';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function sumCurrencies(tranferwiseToken: string, targetCurrency: string, balances: Map<string, number>): Promise<number> {
    return Promise.all(
            Array.from(balances).map(([currency, value]) => {
                return getRate(tranferwiseToken, currency, targetCurrency)
                    .then(rate => Math.round(rate * value));
            })
        )
        .then(totals => totals.reduce((a, b) => a + b, 0));
}

export function updateCurrencyFluctuation(
        ynabAPI: ynab.API,
        budget: ynab.BudgetSummary,
        account: ynab.Account,
        transactions: Array<ynab.TransactionDetail>,
        fluctuation_payee: string,
        amount: number) {

    if (amount !== Math.round(amount)) {
        throw Error("Assertion error: sum should be an integer in milliunits");
    }

    const isCurrencyFluctuation = (tr: ynab.TransactionDetail): boolean =>
        tr.payee_name === fluctuation_payee;

    const diff = amount - account.cleared_balance;
    const currencyTr = lodash.maxBy(
        transactions.filter(isCleared).filter(isCurrencyFluctuation),
        tr => tr.date);

    if (currencyTr != null && shouldUpdateTransaction(currencyTr)) {
        const transaction = {
            ...currencyTr,
            amount: currencyTr.amount + diff,
        };

        console.log(`Updating transaction (payee: '${currencyTr.payee_name}', date: '${currencyTr.date}'):`)
        console.log(`\t- Previous amount: ${ynab.utils.convertMilliUnitsToCurrencyAmount(currencyTr.amount)}`);
        console.log(`\t- New amount: ${ynab.utils.convertMilliUnitsToCurrencyAmount(transaction.amount)}`);

        return ynabAPI.transactions.updateTransaction(budget.id, currencyTr.id, { transaction })
            .then(resp => resp.data.transaction);
    } else {
        const transaction: ynab.SaveTransaction = {
            account_id: account.id,
            amount: diff,
            date: ynab.utils.getCurrentDateInISOFormat(),
            payee_name: fluctuation_payee,
            cleared: ynab.TransactionDetail.ClearedEnum.Reconciled,
            approved: true,
        };

        console.log(`Creating new transaction (payee: '${transaction.payee_name}', date: '${transaction.date}'):`)
        console.log(`\t- New amount: ${ynab.utils.convertMilliUnitsToCurrencyAmount(transaction.amount)}`);

        return ynabAPI.transactions.createTransaction(budget.id, { transaction })
            .then(resp => {
                const tr = resp.data.transaction;
                if (tr == null) {
                    throw Error("Null response from createTransaction: " + JSON.stringify(resp));
                }
                return tr;
            })
    }
}

function shouldUpdateTransaction(tr: ynab.TransactionDetail): boolean {
    /* If the user updates the currency fluctuations every day
     * we don't want to pollute their YNAB with too many transactions.
     * So we only create a new transaction if:
     *  - it's been more than 7 days since the previous one
     *  - we are in a new calendar month
     * Otherwise we update the amount on the old transaction.
     */
    const today = ynab.utils.getCurrentDateInISOFormat();
    return isoDateDiff(today, tr.date) < SEVEN_DAYS_MS
        && isoDateHasNameMonth(today, tr.date);
}

function isoDateDiff(a: string, b: string): number {
    return Math.abs(Date.parse(a) - Date.parse(b));
}

function isoDateHasNameMonth(a: string, b: string): boolean {
    return a.substr(0, 7) === b.substr(0, 7);
}
