import fs from "node:fs";
import path from "node:path";
import { readConfig } from "#lib/config";
import CryptoStorage from "../storage.js";

export default class LocalCryptoStorage extends CryptoStorage {
    #storagePath;

    constructor ( ...args ) {
        super( ...args );

        this.#storagePath = this.app.env.dataDir + "/crypto/storage.json";
    }

    // protected
    async _init () {
        return result( 200 );
    }

    async _loadKeys () {
        if ( await fs.promises.stat( this.#storagePath ).catch( e => null ) ) {
            return result( 200, readConfig( this.#storagePath ) );
        }
        else {
            return result( 200 );
        }
    }

    async _addKey ( type ) {
        var res,
            id = 0;

        res = await this._loadKeys();
        if ( !res.ok ) return res;

        const keys = res.data || [];

        for ( const row of keys ) {
            if ( row.id > id ) id = row.id;

            if ( row.type === type ) row.active = false;
        }

        // generate key
        res = await this._generateKey( type );
        if ( !res.ok ) return res;

        const key = res.data;

        key.id = ++id;
        key.active = true;

        const encryptedKey = {
            ...key,
        };

        encryptedKey.key = this._wrapKey( key );

        keys.push( encryptedKey );

        await this.#storeKeys( keys );

        return result( 200, key );
    }

    // private
    async #storeKeys ( keys ) {
        await fs.promises.mkdir( path.dirname( this.#storagePath ), {
            "recursive": true,
        } );

        return fs.promises.writeFile( this.#storagePath, JSON.stringify( keys ) );
    }
}