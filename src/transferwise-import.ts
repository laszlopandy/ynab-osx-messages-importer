
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as ynab from 'ynab';
import { getBudgetAccountsTransactions, isCleared, findByName } from './helpers';
import * as lodash from 'lodash';


interface Config {
    ynab_token: string;
    transferwise_token: string;
    budget_name: string;
    budget_currency: string;
    transferwise_account_name: string;
    currency_fluctuation_payee: string;
}

type BorderlessAccountResponse = Array<{
    profileId: number;
    balances: Array<{
        amount: {
            value: number,
            currency: string
        }
    }>;
}>

type ProfileResponse = Array<{ id: number, type: string }>;

type RateResponse = Array<{ rate: number }>;

function fetchWithToken(token: string, url: string): Promise<any> {
    return fetch(url,
        {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        })
        .then(response => response.json());
}

function getProfileId(token: string): Promise<number> {

    return fetchWithToken(token, "https://api.transferwise.com/v1/profiles")
        .then((list: ProfileResponse) => {
            const profile = list.find(x => x.type === "personal");
            if (profile == null) {
                throw Error("Cannot get personal Transferwise profile ID");
            }
            return profile.id;
        });
}

function getBalances(token: string, profileId: number): Promise<Map<string, number>> {
    return fetchWithToken(token, `https://api.transferwise.com/v1/borderless-accounts?profileId=${profileId}`)
        .then((resp: BorderlessAccountResponse) => {
            const account = resp.find(x => x.profileId === profileId);
            if (account == null) {
                throw Error("Cannot match profileId in account response");
            }
            const dict = new Map();
            account.balances.map(b => [b.amount.currency, b.amount.value])
                .forEach(([ currency, value ]) => {
                    let old = dict.has(currency) ? dict.get(currency) : 0;
                    dict.set(currency, old + value);
                });
            return dict;
        });
}

function getRate(token: string, source: string, target: string, date?: string): Promise<number> {
    if (source === target) {
        return Promise.resolve(1);
    }

    let url = `https://api.transferwise.com/v1/rates?source=${source}&target=${target}`;
    if (/^\d\d\d\d-\d\d-\d\d$/.test(date || "")) {
        url += `&${date}T12:00`;
    }
    return fetchWithToken(token, url)
        .then((resp: RateResponse) => {
            return resp[0].rate;
        });
}

function main() {
    const config: Config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

    const token = config.transferwise_token;
    const target_currency = config.budget_currency;

    const valueSumPromise = getProfileId(token)
        .then(id => getBalances(token, id))
        .then(balances => {
            console.log("Transferwise balances:");
            balances.forEach((value, currency) => {
                console.log(`\t- ${currency}: ${value.toFixed(2)}`);
            });

            return Promise.all(
                Array.from(balances).map(([currency, value]) => {
                    return getRate(token, currency, target_currency)
                        .then(rate => {
                            return rate * value;
                        });
                })
            );
        })
        .then(totals => totals.reduce((a, b) => a + b, 0))
        .then(sum => Math.floor(sum));

    const ynabAPI = new ynab.API(config.ynab_token);
    const budgetAccountsTransactions = getBudgetAccountsTransactions(
        ynabAPI,
        config.budget_name,
        config.transferwise_account_name);

    const isCurrencyFluctuation = (tr: ynab.TransactionDetail): boolean =>
        tr.payee_name === config.currency_fluctuation_payee;

    Promise.all([valueSumPromise, budgetAccountsTransactions])
        .then(([sum, [budget, accounts, transactions]]): Promise<ynab.TransactionDetail> => {
            const account = findByName(accounts, config.transferwise_account_name);
            const diff = (sum * 1000) - account.cleared_balance;
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