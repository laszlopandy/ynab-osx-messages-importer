
import * as fs from 'fs';
import * as lodash from 'lodash';
import * as ynab from 'ynab';
import { getBalances, getRate } from './helpers/transferwise';
import { getBudgetAccountsTransactions, isCleared, findByName } from './helpers/ynab';
import { updateCurrencyFluctuation, sumCurrencies } from './helpers/currency-fluctuations';


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

            return sumCurrencies(token, target_currency, balances);
        })

    const ynabAPI = new ynab.API(config.ynab_token);
    const budgetAccountsTransactions = getBudgetAccountsTransactions(
        ynabAPI,
        config.budget_name,
        config.transferwise_account_name);

    Promise.all([valueSumPromise, budgetAccountsTransactions])
        .then(([sum, [budget, accounts, transactions]]): Promise<ynab.TransactionDetail> => {
            return updateCurrencyFluctuation(
                    ynabAPI,
                    budget,
                    findByName(accounts, config.transferwise_account_name),
                    transactions,
                    config.currency_fluctuation_payee,
                    sum
                );
        })
        .catch((reason: any) => {
            const message = (reason instanceof Error) ? reason.toString() : "Error:" + JSON.stringify(reason);
            console.log(message);
        });
}

if (require.main === module) {
    main();
}