import { validateEmail } from "#lib/validate";
import crypto from "node:crypto";
import sql from "#lib/sql";
import constants from "#lib/app/constants";

const SQL = {
    "getTelegramUserByEmail": sql`
SELECT
    telegram_user.id
FROM
    "user",
    telegram_user
WHERE
    "user".email = ?
    AND "user".id = telegram_user.api_user_id
`.prepare(),

    "setApiUserId": sql`
UPDATE
    telegram_user
SET
    api_user_id = ?
WHERE
    id = ?
    AND ( api_user_id IS NULL OR api_user_id = ? )
`.prepare(),
};

export default Super =>
    class extends Super {

        // public
        getDescription ( ctx ) {
            return this.l10nt( `sign in to your account` );
        }

        async run ( ctx, req ) {

            // already signed-in
            if ( ctx.user.apiUserId ) {
                return this.#signinComplete( ctx );
            }

            // sign up automatically
            else if ( this.bot.config.telegram.signinRequired && !this.bot.config.telegram.signupEnabled ) {
                return this.#signUpAutomatically( ctx );
            }

            // request email
            else if ( !ctx.state?.email ) {
                return this.#requestEmail( ctx, req );
            }

            // wait for email confirmation
            else {
                return this.#requestEmailConfirmation( ctx );
            }
        }

        async API_resendConfirmatioEmail ( ctx ) {

            // signin done
            if ( ctx.user.apiUserId ) return this.#signinComplete( ctx );

            await this.#sendConfirmationEmail( ctx );

            return this.#requestEmailConfirmation( ctx );
        }

        async API_changeEmail ( ctx ) {

            // signin done
            if ( ctx.user.apiUserId ) return this.#signinComplete( ctx );

            await this.#deleteConfirmationMessage( ctx );

            await this.#setEmail( ctx );

            return this.run( ctx );
        }

        async API_signIn ( ctx, token ) {

            // signin done
            if ( ctx.user.apiUserId ) return this.#signinComplete( ctx );

            const email = ctx.state?.email;

            CONFIRM: if ( email ) {
                const validToken = crypto
                    .createHmac( "md5", this.bot.telegramBotApi.apiToken )
                    .update( ctx.user.telegramUserId + "/" )
                    .update( email )
                    .digest( "hex" );

                // token is not valie
                if ( token.toString( "hex" ) !== validToken ) break CONFIRM;

                const res = await this.dbh.begin( async dbh => {
                    let apiUserId;

                    const apiUser = await this.app.users.getUserByEmail( email, { dbh } );

                    // api user exists
                    if ( apiUser ) {
                        apiUserId = apiUser.id;
                    }

                    // api user not exists
                    else {

                        // sign up is disabled
                        if ( !this.bot.config.telegram.signupEnabled ) {
                            await this.#setEmail( ctx );

                            throw result( [ 500, `Sign up is not enabled` ] );
                        }

                        // create user
                        const res = await this.#createApiUser( ctx, email, {
                            "emailConfirmed": true,
                            dbh,
                        } );

                        if ( !res.ok ) throw res;

                        apiUserId = res.data.id;
                    }

                    // set api user
                    const res = await this.#setApiUser( ctx, apiUserId, { dbh } );

                    if ( !res.ok ) throw res;

                    return result( 200, apiUserId );
                } );

                if ( !res.ok ) break CONFIRM;

                // send event
                const telegramUser = await this.app.notifications?.getTelegramBotUserByApiUserId( res.data );

                if ( telegramUser ) {
                    this.app.publishToApi( "/notifications/telegram/update/", res.data, telegramUser );
                }

                return this.#signinComplete( ctx );
            }

            // confirmation failed
            await ctx.sendText( this.l10nt( `Confirmation link is not valid. Please, try again.` ) );

            return this.run( ctx );
        }

        // private
        async #signUpAutomatically ( ctx ) {
            const res = await this.dbh.begin( async dbh => {
                var apiUserId;

                const email = ctx.user.telegramUserId + "@telegram" + constants.localEmailTld;

                const apiUser = await this.app.users.getUserByEmail( email, { dbh } );

                // api user exists
                if ( apiUser ) {
                    apiUserId = apiUser.id;
                }

                // api user not exists
                else {

                    // create api user
                    const res = await this.#createApiUser( ctx, email, { dbh } );

                    if ( !res.ok ) throw res;

                    apiUserId = res.data.id;
                }

                // set api user
                const res = await this.#setApiUser( ctx, apiUserId, { dbh } );

                if ( !res.ok ) throw res;
            } );

            if ( !res.ok ) {
                console.error( `Error sign up telegram user:`, res + "" );
            }

            return ctx.run( "start" );
        }

        async #requestEmail ( ctx, req ) {
            EMAIL: if ( req?.message.text && !req.command ) {
                const email = req.message.text.toLowerCase();

                // email is not valid
                if ( !validateEmail( email ).ok ) {
                    await ctx.sendText( this.l10nt( `Email address is not valid` ) );
                }

                // email is valid
                else {

                    // signup is disabled
                    if ( !this.bot.config.telegram.signupEnabled ) {
                        const user = await this.app.users.getUserByEmail( email );

                        // appi user is not exists
                        if ( !user ) {
                            await ctx.sendText( this.l10nt( `This email address is not registered` ) );

                            break EMAIL;
                        }
                    }

                    const res = await this.dbh.selectRow( SQL.getTelegramUserByEmail, [ email ] );

                    // error
                    if ( !res.ok ) return this.run( ctx );

                    // email api aser already has linked telegram account
                    if ( res.data?.id ) {
                        await ctx.sendText( this.l10nt( `This email address is already used by the other user` ) );
                    }

                    // set signin email
                    else {
                        await this.#setEmail( ctx, email );

                        return this.#sendConfirmationEmail( ctx );
                    }
                }
            }

            return ctx.sendMessage( {
                "text": this.l10nt( `To sign in, please, enter yoour email address` ),
            } );
        }

        async #requestEmailConfirmation ( ctx ) {
            await this.#deleteConfirmationMessage( ctx );

            const res = await ctx.sendMessage( {
                "text": this.l10nt( `To complete sign in, please, click on link which I just sent to your email address.
If you didn't received emaul in several minutes you can send it again.` ),
                "reply_markup": {
                    "inline_keyboard": [
                        [
                            {
                                "text": this.l10nt( `Send confirmation email again` ),
                                "callback_data": this.encodeCallbackData( "resendConfirmatioEmail" ),
                            },
                        ],
                        [
                            {
                                "text": this.l10nt( `Change email address` ),
                                "callback_data": this.encodeCallbackData( "changeEmail" ),
                            },
                        ],
                    ],
                },
            } );

            if ( res.ok ) {
                await ctx.updateState( {
                    "confirmationMessageId": res.data.message_id,
                } );
            }
        }

        async #signinComplete ( ctx ) {
            const apiUser = await ctx.user.getApiUser();

            await this.#deleteConfirmationMessage( ctx );

            // clear state
            await ctx.clearState();

            return ctx.sendMessage( {
                "text": this.l10nt( msgid`You are signed in as: ${ apiUser.email }` ),
                "reply_markup": {
                    "inline_keyboard": [
                        [
                            {
                                "text": this.createBackButtonText( this.l10nt( `Return to start` ) ),
                                "callback_data": this.encodeCallbackData( "run", "start" ),
                            },
                        ],
                    ],
                },
            } );
        }

        async #sendConfirmationEmail ( ctx ) {
            const token = crypto
                .createHmac( "md5", this.bot.telegramBotApi.apiToken )
                .update( ctx.user.telegramUserId + "/" )
                .update( ctx.state?.email )
                .digest();

            await this.app.notifications.sendEmail(
                ctx.state?.email,
                this.app.templates.get( "telegram/sign-in-email/subject" ).toString( {
                    "localeDomain": ctx.user.id,
                    "data": {
                        "telegramBotName": this.bot.name,
                    },
                } ),
                this.app.templates.get( "telegram/sign-in-email/body" ).toString( {
                    "localeDomain": ctx.user.id,
                    "data": {
                        "url": this.createStartUrl( null, "signIn", token ),
                        "telegramBotName": this.bot.name,
                    },
                } )
            );

            return this.#requestEmailConfirmation( ctx );
        }

        async #setEmail ( ctx, email ) {
            return ctx.updateState( {
                "email": email || null,
            } );
        }

        async #deleteConfirmationMessage ( ctx ) {
            if ( !ctx.state?.confirmationMessageId ) return;

            await ctx.sendDeleteMessage( ctx.state.confirmationMessageId );

            await ctx.updateState( {
                "confirmationMessageId": undefined,
            } );
        }

        async #createApiUser ( ctx, email, { emailConfirmed, dbh } = {} ) {
            dbh ||= this.dbh;

            return this.app.users.createUser( email, {
                "locale": ctx.user.locale,
                "emailConfirmed": !!emailConfirmed,
                dbh,
            } );
        }

        async #setApiUser ( ctx, apiUserId, { dbh } = {} ) {
            dbh ||= this.dbh;

            const res = await dbh.do( SQL.setApiUserId, [

                //
                apiUserId,
                ctx.user.telegramUserId,
                apiUserId,
            ] );

            if ( !res.ok ) return res;

            if ( !res.meta.rows ) return result( [ 500, `Unable to set user id` ] );

            return res;
        }
    };