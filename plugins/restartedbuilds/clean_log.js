const stripAnsi = require('strip-ansi')

const properties = [
    /(hostname:).*/g,
    /(version:).*/g,
    /(instance:).*/g,
    /(startup:).*/g,
    /(travis-build version:).*/g,
    /(process ).*/g,
    // /(Get|Ign|Hit):\d+/g,
]
const startWith = [
    'Get',
    'Ign',
    'Hit',
    'Receiving objects:',
    'Resolving deltas:',
    'Unpacking objects:',
    'Reading package lists...',
    'Fetched',
    'Updating files:',
    'This take some time...',
    'travis_time:',
    'travis_fold',
    'remote:',
    '/home/travis/',
    '...'
]
const toRemove = [
    // date
    // /.{3}, +(\d{1,2}) +.{3} (\d{1,4}) (\d{1,2}):(\d{1,2}):(\d{1,2}) +\+(\d{1,2})/g,
    // /.{3}, +(\d{1,2}):(\d{1,2}):(\d{1,2}) \+(\d+)/g,
    // /(\d+)\.(\d+):(\d+):(\d+)\.(\d+)/g,
    // /(\d+)-(\d+)-(\d+) (\d{1,2}):(\d{1,2}):(\d+)/g,
    // /(\d+)\/(\d{1,2})\/(\d+) (\d{1,2}):(\d{1,2}):(\d+) (PM|AM|pm|am)/g,
    // /(\d{1,2}):(\d{1,2}):(\d{1,2})/g,
    /(\d{1,4})(-|\/)(\d{1,2})(-|\/)(\d{1,4})( |T)?/g,
    /(\d{1,2}):(\d{1,2}):(\d{1,2})((\.|\+|,)(\d{1,4}))?( (PM|AM|pm|am))?( [A-Z]{3})?/g,
    // /\d{1,2}:\d{1,2}:\d{1,2}( [A-Z]{3})?/g,
    // Wed Oct 09 01:10:19 UTC 2019
    /.{3},?( .{3})? +(\d{1,2})( +.{3})?( |,)+(\d{1,4})/g,
    // travis stuffs
    /\((\d+)\/(\d+)\)/g,
    // java object id
    /(\@|\$\$)[0-9a-z]+(\:|{|,|]| )/g,
    // ids
    /[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}/,
    /(\d{5,})/g,
    /([0-9a-f]{10,})/g,
    // time
    /\d+:\d+ min/gi,
    /(-->) +(\d+)%/g,
    /([\d\.]+)m?s/gi,
    /([0-9\.]+)M=0s/gi,
    /([0-9\,\.]+) ?k?M?B(\/s)?/gi,
    /([0-9\.]+) (seconds|secs|s|sec)/g,
    /(▉|█|▋)+/g,
    /\[\d+\/\d+\]/,
    // ip
    /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g,
    /\d{1,2} ?%/g,
]

function isEmpty(str) {
    const trimmedLine = str.trim()
    if (trimmedLine.length == 0 || trimmedLine == '' || trimmedLine[1] == '%' || trimmedLine[2] == '%') {
        return true;
    }
    return false;
}

module.exports.cleanLog = function (log) {
    const hrstart = process.hrtime()

    const output = []

    log = stripAnsi(log).replace(/(?:\\[rn]|[\r\n])/g,'\n')
    const lines = log.split('\n')
    line: for (let line of lines) {
        if(isEmpty(line)) {
            continue;
        }
        for (let property of startWith) {
            if (line.indexOf(property) > -1) {
                continue line;
            }
        }
        for (let property of properties) {
            line = line.replace(property, '$1')
        }
        for (let property of toRemove) {
            line = line.replace(property, '')
        }
        if(isEmpty(line)) {
            continue line;
        }
        output.push(line)
    }
    const out = output.join('\n')
    var hrend = process.hrtime(hrstart)
    console.info('Execution time (hr): %ds %dms', hrend[0], hrend[1] / 1000000)
    return out;
}