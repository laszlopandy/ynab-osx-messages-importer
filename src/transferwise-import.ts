
import * as fs from 'fs';
import * as lodash from 'lodash';
import * as ynab from 'ynab';
import { getBalances, getRate } from './helpers/transferwise';
import { getBudgetAccountsTransactions, isCleared, findByName } from './helpers/ynab';


interface Config {
    ynab_token: string;
    transferwise_token: string;
    budget_name: string;
    budget_currency: string;
    transferwise_account_name: string;
    currency_fluctuation_payee: string;
}

function main() {
    const config: Config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

    const token = config.transferwise_token;
    const target_currency = config.budget_currency;

    const valueSumPromise = getBalances(token)
        .then(balances => {
            console.log("Transferwise balances:");
            balances.forEach((value, currency) => {
                console.log(`\t- ${currency}: ${ynab.utils.convertMilliUnitsToCurrencyAmount(value)}`);
            });

            return Promise.all(
                Array.from(balances).map(([currency, value]) => {
                    return getRate(token, currency, target_currency)
                        .then(rate => Math.round(rate * value));
                })
            );
        })
        .then(totals => totals.reduce((a, b) => a + b, 0));

    const ynabAPI = new ynab.API(config.ynab_token);
    const budgetAccountsTransactions = getBudgetAccountsTransactions(
        ynabAPI,
        config.budget_name,
        config.transferwise_account_name);

    const isCurrencyFluctuation = (tr: ynab.TransactionDetail): boolean =>
        tr.payee_name === config.currency_fluctuation_payee;

    Promise.all([valueSumPromise, budgetAccountsTransactions])
        .then(([sum, [budget, accounts, transactions]]): Promise<ynab.TransactionDetail> => {
            if (sum !== Math.round(sum)) {
                throw Error("Assertion error: sum should be an integer in milliunits");
            }

            const account = findByName(accounts, config.transferwise_account_name);
            const diff = sum - account.cleared_balance;
            const currencyTr = lodash.maxBy(
                transactions.filter(isCleared).filter(isCurrencyFluctuation),
                tr => tr.date);

            const dateAndMonth = ynab.utils.getCurrentDateInISOFormat().substr(0, 7);
            if (currencyTr != null && currencyTr.date.substr(0, 7) === dateAndMonth) {
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
                    payee_name: config.currency_fluctuation_payee,
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
        })
        .catch((reason: any) => {
            const message = (reason instanceof Error) ? reason.toString() : "Error:" + JSON.stringify(reason);
            console.log(message);
        });
}

if (require.main === module) {
    main();
}