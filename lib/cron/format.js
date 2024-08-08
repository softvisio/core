import "#lib/temporal";

// NOTE https://www.man7.org/linux/man-pages/man5/crontab.5.html

const FIELDS = [
    {
        "name": "seconds",
        "min": 0,
        "max": 59,
    },
    {
        "name": "minutes",
        "min": 0,
        "max": 59,
    },
    {
        "name": "hours",
        "min": 0,
        "max": 23,
    },
    {
        "name": "days",
        "min": 1,
        "max": 31,
    },
    {
        "name": "months",
        "min": 1,
        "max": 12,
        "names": {
            "jan": 1,
            "feb": 2,
            "mar": 3,
            "apr": 4,
            "may": 5,
            "jun": 6,
            "jul": 7,
            "aug": 8,
            "sep": 9,
            "oct": 10,
            "nov": 11,
            "dec": 12,
        },
    },
    {
        "name": "daysOfWeek",
        "min": 0,
        "max": 6,
        "names": {
            "sun": 0,
            "mon": 1,
            "tue": 2,
            "wed": 3,
            "thu": 4,
            "fri": 5,
            "sat": 6,
        },
    },
];

const FIELDS_INDEX = Object.fromEntries( FIELDS.map( field => {
    return [ field.name, field ];
} ) );

export default class CronFormat {
    #format;
    #timezone;
    #ignoreSeconds;
    #hasSeconds;
    #fields = {};

    constructor ( format, { timezone, ignoreSeconds } = {} ) {
        this.#format = format;
        this.#ignoreSeconds = !!ignoreSeconds;

        if ( timezone ) {
            this.#timezone = Temporal.TimeZone.from( timezone ).id;
        }
        else {
            this.#timezone = Temporal.Now.timeZoneId();
        }

        const fields = format.split( " " );

        if ( fields.length < 5 || fields.length > 6 ) {
            throw Error( `Cron is not valid` );
        }

        if ( fields.length === 6 ) {
            if ( this.#ignoreSeconds ) {
                fields.shift();
            }
        }

        if ( fields.length === 5 ) {
            this.#hasSeconds = false;
        }
        else {
            this.#hasSeconds = true;
        }

        for ( let n = 0; n < fields.length; n++ ) {
            this.#parseField( fields[ n ], FIELDS[ n + ( this.#hasSeconds ? 0 : 1 ) ] );
        }
    }

    // static
    static isValid ( value, options ) {
        try {
            new this( value, options );

            return true;
        }
        catch ( e ) {
            return false;
        }
    }

    // properties
    get timezone () {
        return this.#timezone;
    }

    get ignoreSeconds () {
        return this.#ignoreSeconds;
    }

    get hasSeconds () {
        return this.#hasSeconds;
    }

    // public
    toString () {
        return this.#format;
    }

    toJSON () {
        return this.toString();
    }

    getSchedule ( { fromDate, maxItems = 1 } = {} ) {
        if ( fromDate ) {
            fromDate = fromDate.toTemporalInstant().toZonedDateTimeISO( this.#timezone );
        }
        else {
            fromDate = Temporal.Now.instant().toZonedDateTimeISO( this.#timezone );
        }

        // round to the seconds
        fromDate = fromDate.round( {
            "smallestUnit": "seconds",
            "roundingMode": "ceil",
        } );

        const dates = [];

        for ( let n = 0; n < maxItems; n++ ) {
            fromDate = this.#getNextDate( fromDate );

            dates.push( new Date( fromDate.epochMilliseconds ) );

            if ( this.#hasSeconds ) {
                fromDate = fromDate.add( { "seconds": 1 } );
            }
            else {
                fromDate = fromDate.add( { "minutes": 1 } );
            }
        }

        return dates;
    }

    // private
    #parseField ( fieldValue, field ) {
        if ( fieldValue === "*" ) return;

        let usedValues = 0;

        const values = new Array( field.max + 1 );

        const ranges = fieldValue.split( "," );

        for ( const range of ranges ) {
            var [ body, step ] = range.split( "/" );

            if ( step ) {
                step = +step;
                if ( !Number.isInteger( step ) ) this.#throwError( fieldValue, field );
            }
            else {
                step = 0;
            }

            let [ start, end ] = body.split( "-" );

            if ( !start ) {
                this.#throwError( fieldValue, field );
            }
            else if ( start === "*" ) {
                start = field.min;
                end = field.max;
            }

            // field is restricted
            else {
                this.#fields[ field.name + "Restricted" ] = true;

                if ( field.names?.[ start ] != null ) {
                    start = field.names[ start ];
                }
            }

            start = +start;
            if ( !Number.isInteger( start ) ) this.#throwError( fieldValue, field );

            if ( start < field.min ) this.#throwError( fieldValue, field );

            if ( end ) {
                if ( field.names?.[ end ] != null ) end = field.names[ end ];

                end = +end;
                if ( !Number.isInteger( end ) ) this.#throwError( fieldValue, field );

                // special case fordaysOfWeek, map 7 to 0
                if ( end === 7 && field.name === "daysOfWeek" ) {
                    end = start;
                    start = 0;
                }

                if ( end > field.max ) this.#throwError( fieldValue, field );

                if ( end < start ) this.#throwError( fieldValue, field );

                if ( step > end - start ) this.#throwError( fieldValue, field );

                for ( let n = 0; n <= end - start; n++ ) {
                    if ( n % step ) continue;

                    if ( !values[ start + n ] ) {
                        values[ start + n ] = true;

                        usedValues++;
                    }
                }
            }
            else {
                if ( step ) this.#throwError( fieldValue, field );

                if ( !values[ start ] ) {
                    values[ start ] = true;

                    usedValues++;
                }
            }
        }

        // store values if partial range used
        if ( usedValues < field.max ) {
            this.#fields[ field.name ] = values;
        }
    }

    #throwError ( fieldValue, field ) {
        throw Error( `Cron ${ field.name } field is not valid: ${ fieldValue }` );
    }

    #getNextDate ( date ) {
        while ( true ) {

            // current month is not allowed
            if ( this.#fields.months && !this.#fields.months[ date.month ] ) {
                date = date
                    .add( {
                        "months": this.#getAddValue( date.month, FIELDS_INDEX.months ),
                    } )
                    .with( {
                        "day": 1,
                    } )
                    .round( {
                        "smallestUnit": "days",
                        "roundingMode": "floor",
                    } );

                continue;
            }

            let addDays = 0,
                addDaysOfWeek = 0;

            // current day of month is not allowed
            if ( this.#fields.days && !this.#fields.days[ date.day ] ) {
                addDays = this.#getAddValue( date.day, FIELDS_INDEX.days );
            }

            // current day of week is not allowed
            if ( this.#fields.daysOfWeek && !this.#fields.daysOfWeek[ date.dayOfWeek === 7 ? 0 : date.dayOfWeek ] ) {
                addDaysOfWeek = this.#getAddValue( date.dayOfWeek === 7 ? 0 : date.dayOfWeek, FIELDS_INDEX.daysOfWeek );
            }

            // current day or day of week are not allowed
            ADD_DAYS: if ( addDays || addDaysOfWeek ) {

                // if days are restrictes
                // or days of week are restricted
                // match days OR day of week
                if ( this.#fields.daysRestricted && this.#fields.daysOfWeekRestricted ) {

                    // current day or day of week are allowed
                    if ( !addDays || !addDaysOfWeek ) {
                        break ADD_DAYS;
                    }
                }

                date = date
                    .add( {
                        "days": addDays ? ( addDaysOfWeek ? ( addDays < addDaysOfWeek ? addDays : addDaysOfWeek ) : addDays ) : addDaysOfWeek,
                    } )
                    .round( {
                        "smallestUnit": "days",
                        "roundingMode": "floor",
                    } );

                continue;
            }

            // current hour is not allowed
            if ( this.#fields.hours && !this.#fields.hours[ date.hour ] ) {
                date = date
                    .add( {
                        "hours": this.#getAddValue( date.hour, FIELDS_INDEX.hours ),
                    } )
                    .round( {
                        "smallestUnit": "hours",
                        "roundingMode": "floor",
                    } );

                continue;
            }

            // current minute is not allowed
            if ( this.#fields.minutes && !this.#fields.minutes[ date.minute ] ) {
                date = date
                    .add( {
                        "minutes": this.#getAddValue( date.minute, FIELDS_INDEX.minutes ),
                    } )
                    .round( {
                        "smallestUnit": "minutes",
                        "roundingMode": "floor",
                    } );

                continue;
            }

            // current second is not allowed
            if ( this.#fields.seconds && !this.#fields.seconds[ date.second ] ) {
                date = date.add( {
                    "seconds": this.#getAddValue( date.second, FIELDS_INDEX.seconds ),
                } );

                continue;
            }

            // found date, which is match all conditions
            break;
        }

        return date;
    }

    #getAddValue ( currentValue, field ) {
        var add = 0,
            values = this.#fields[ field.name ];

        for ( let n = currentValue + 1; n < values.length; n++ ) {
            add++;

            if ( values[ n ] ) return add;
        }

        for ( let n = field.min; n < currentValue; n++ ) {
            add++;

            if ( values[ n ] ) return add;
        }

        throw Error( `Cron: next value error` );
    }
}