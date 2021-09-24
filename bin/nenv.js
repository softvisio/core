import child_process from "child_process";

process.argv.shift();
process.argv.shift();

while ( process.argv.length ) {
    const arg = process.argv.shift();

    const idx = arg.indexOf( "=" );

    if ( idx < 1 ) {
        process.argv.unshift( arg );

        break;
    }

    process.env[arg.substr( 0, idx )] = arg.substring( idx + 1 );
}

if ( !process.argv.length ) process.exit( 2 );

try {
    child_process.execFileSync( process.argv.shift(), process.argv, { "stdio": "inherit", "shell": true } );
}
catch ( e ) {
    process.exit( 2 );
}
