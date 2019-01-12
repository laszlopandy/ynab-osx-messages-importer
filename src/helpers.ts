import * as ynab from 'ynab';

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

function getAccounts(
        api: ynab.API, budgetPromise: Promise<ynab.BudgetSummary>): Promise<Array<ynab.Account>> {

    return budgetPromise
        .then(budget => api.accounts.getAccounts(budget.id))
        .then(resp => {
            return resp.data.accounts;
        })
}

export function isCleared(t: ynab.TransactionSummary): boolean {
    return t.cleared == ynab.TransactionDetail.ClearedEnum.Cleared || t.cleared == ynab.TransactionDetail.ClearedEnum.Reconciled;
}

export function findByName(list: Array<ynab.Account>, name: string): ynab.Account {
    const item = list.find(x => x.name === name);
    if (item == null) {
        throw Error("Cannot find account with name: " + name);
    }
    return item;
}

type YnabTriplet = [ ynab.BudgetSummary, Array<ynab.Account>, Array<ynab.TransactionDetail> ];

export function getBudgetAccountsTransactions(api: ynab.API, budgetName: string, primaryAccountName: string): Promise<YnabTriplet> {
    const budgetPromise = getBudgetByName(api, budgetName);
    const accountsPromise = getAccounts(api, budgetPromise);

    return Promise.all([ budgetPromise, accountsPromise ])
        .then(([ budget, accounts ]) => {
            console.log("Downloading transactions");

            const primaryAccount = findByName(accounts, primaryAccountName);

            return api.transactions.getTransactionsByAccount(budget.id, primaryAccount.id)
                .then((resp: ynab.TransactionsResponse): YnabTriplet => {
                    return [ budget, accounts, resp.data.transactions ];
                });
        });
}
