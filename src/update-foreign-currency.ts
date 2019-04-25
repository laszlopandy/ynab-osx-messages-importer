
import * as fs from 'fs';
import * as readline from 'readline';
import * as ynab from 'ynab';
import { getBudgetAccountsTransactions, findByName, getBudgetByName, getAccounts } from './helpers/ynab';
import { logError } from './common';
import { updateCurrencyFluctuation, sumCurrencies } from './helpers/currency-fluctuations';
import { getRate } from './helpers/transferwise';


interface Config {
    ynab_token: string;
    transferwise_token: string;
    budget_name: string;
    budget_currency: string;
    transferwise_account_name: string;
    currency_fluctuation_payee: string;
    foreign_currency_accounts: { [name: string]: string };
}

function inputBalance(accountName: string, currency: string): Promise<number> {
    const rl = readline.createInterface(process.stdin, process.stdout)
    return new Promise<string>(resolve => {
        rl.question(`Enter the balance or balances for account '${accountName}' in ${currency}:\n`, resolve);
    })
    .then(s => {
        rl.close();

        const list = s.split("+").map(x => x.replace(/,/, "")).map(parseFloat)
        const sum = list.reduce((a, b) => a + b, 0);
        if (!isFinite(sum)) {
            throw new Error("cannot parse number");
        }

        return sum;
    });
}

function main() {
    const config: Config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

    const ynabAPI = new ynab.API(config.ynab_token);
    const budgetPromise = getBudgetByName(ynabAPI, config.budget_name);
    const accountsPromise = getAccounts(ynabAPI, budgetPromise);

    const balancesPromise = Promise.all(
        Object.keys(config.foreign_currency_accounts).map(accountName => {
            const accountCurrency = config.foreign_currency_accounts[accountName];
            return inputBalance(accountName, accountCurrency)
                .then(amount => [accountName, Math.round(amount * 1000)] as [string, number]);
        }))
        .then(entries => new Map(entries))
        .then(balances => {
            console.log("Total balances:");
            balances.forEach((milliunits, accountName) => {
                const amount = ynab.utils.convertMilliUnitsToCurrencyAmount(milliunits);
                const currency = config.foreign_currency_accounts[accountName];
                console.log(`\t- ${accountName}: ${amount} ${currency}`);
            });
            return balances;
        });

    const currencies = new Set(Object.keys(config.foreign_currency_accounts).map(k => config.foreign_currency_accounts[k]));
    const ratesPromise = Promise.all(
        Array.from(currencies.values())
            .map(currency => {
                return getRate(config.transferwise_token, currency, config.budget_currency)
                    .then(rate => [currency, rate] as [string, number])
            })
        ).then(entries => new Map(entries));

    Promise.all([balancesPromise, ratesPromise, budgetPromise, accountsPromise])
        .then(([balances, rates, budget, accounts]) => {
            balances.forEach((milliunits, accountName) => {
                const account = findByName(accounts, accountName);
                const currency = config.foreign_currency_accounts[accountName];

                ynabAPI.transactions.getTransactionsByAccount(budget.id, account.id)
                    .then(resp => resp.data.transactions)
                    .then(transactions => {
                        const rate = rates.get(currency)!;
                        console.log(`Rate for ${currency}-${config.budget_currency}: ${rate}`);
                        return updateCurrencyFluctuation(
                            ynabAPI,
                            budget,
                            account,
                            transactions,
                            config.currency_fluctuation_payee,
                            Math.round(rate * milliunits)
                        );
                    });
            });
        })
        .catch(logError);
}

if (require.main === module) {
    main();
}