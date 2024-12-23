import sql from "#lib/sql";

export default sql`

CREATE TABLE crypto_storage (
    id serial4 PRIMARY KEY,
    type text NOT NULL,
    created timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active bool NOT NULL,
    key text NOT NULL
);

`;