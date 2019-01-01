
import sqlite from 'sqlite';

function main() {
    console.log("Hellow");
    sqlite.open('/Users/laszlopandy/Library/Messages/chat.db')
        .then(db => {
            db.close
        });
}

if (require.main === module) {
    main();
}