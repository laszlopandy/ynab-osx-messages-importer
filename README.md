# YNAB Messages Importer

My bank doesn't provide an API, however it does send an SMS for every transaction on my account. With a few regular expressions, we can turn it into data that we can import into YNAB.

## Recieving SMS messages on your Mac

Presumably for privacy reasons, iOS doesn't allow apps to access SMS messages. To access them programmatically we have to use a Mac:

 * Enable `Text Message Forwarding` on your iPhone: https://support.apple.com/en-us/HT208386
 * Login to the Messages app on your Mac using the same Apple ID as your phone.

## Example config
Create a file `my-config.json` with your relevant YNAB details:
```js
{
    /* The private YNAB token from your account page */
    "ynab_token": "...",
    /* The name of your budget in YNAB */
    "budget_name": "My Budget",
    /* The YNAB account where the SMS transactions will be imported */
    "primary_account_name": "My YNAB bank account",
    /* The YNAB account where ATM withdrawals will be transfered */
    "cash_account_name": "My YNAB cash account",
    /* The phone numbers that should be queried in the Messages app */
    "bank_sms_numbers": ["+36301234567"]
}
```

## Usage
```sh
$ npm install
$ node ./dist/index.js my-config.json
Connecting to YNAB
Downloading transactions
Querying all SMS messages since 2019-01-10
Ready to import 4 transactions:
...

Successfully imported 2 transactions (2 duplicates)
```

