const express = require('express')
const compression = require('compression')
const MongoClient = require('mongodb').MongoClient;
const Agenda = require('agenda');

const stat = require('./stat').stat

const cleanLog = require('./clean_log').cleanLog
const diff_match_patch = require("diff-match-patch");
require('diff-match-patch-line-and-word')
const dmp = new diff_match_patch();

var port = process.env.PORT || 4000;
const mongoURL = "mongodb://mongo:27017";

const agenda = new Agenda({db: {address: mongoURL + '/agenda'}});

const client = new MongoClient(mongoURL, {useNewUrlParser: true, useUnifiedTopology: true});

const app = express();
app.use(compression())

const server = require('http').Server(app);

app.use('/', express.static(__dirname + '/static'));
    
server.listen(port, function () {
    var port = server.address().port;
    console.log('App running on port ' + port);
});

(async _ => {
    await client.connect();

    const buildsaver_db = client.db("buildsaver");
    const db = client.db("restartedbuilds");

    // create collection
    const buildsCollection = await db.createCollection( "builds")
    const jobsCollection = await db.createCollection( "jobs")
    const logCollection = await db.createCollection( "logs")
    const buildSaverLogCollection = await buildsaver_db.createCollection( "logs")

    // create index
    await buildsCollection.createIndex('id', {unique: true})
    await jobsCollection.createIndex('id', {unique: true})
    await logCollection.createIndex('id', {unique: true})

    require('./jobs/fetchRestartedBuilds')(agenda, db, buildsaver_db);
    require('./jobs/fetchRestartedJobs')(agenda, db, buildsaver_db);
    agenda.start();

    console.log("Restarted Service initialized");
    
    app.get("/api/builds/fetch", async function (req, res) {
        const TASK_NAME = 'fetch restarted builds'
        const lastJobs = await agenda.jobs({name: TASK_NAME}, {_id: -1}, 1);
        if (lastJobs.length == 0) {
            res.json({status: 'ok', job: await agenda.now(TASK_NAME)});
        } else {
            const lastJob = lastJobs[0]
            if ((lastJob.attrs.lockedAt == null && lastJob.attrs.lastRunAt != null) || lastJob.attrs.failedAt) {
                lastJob.attrs.data.index = 0
                res.json({status: 'ok', job: await agenda.now(TASK_NAME, lastJob.attrs.data)});
            } else {
                res.json({status: 'still_running', job: lastJob});
            }
        }
    });

    app.get("/api/jobs/fetch", async function (req, res) {
        const TASK_NAME = 'fetch restarted jobs'
        const lastJobs = await agenda.jobs({name: TASK_NAME}, {_id: -1}, 1);
        if (lastJobs.length == 0) {
            res.json({status: 'ok', job: await agenda.now(TASK_NAME)});
        } else {
            const lastJob = lastJobs[0]
            if ((lastJob.attrs.lockedAt == null && lastJob.attrs.lastRunAt != null) || lastJob.attrs.failedAt) {
                lastJob.attrs.data.index = 0
                res.json({status: 'ok', job: await agenda.now(TASK_NAME, lastJob.attrs.data)});
            } else {
                res.json({status: 'still_running', job: lastJob});
            }
        }
    });

    app.get("/api/tasks", async function (req, res) {
        const lastBuilds = await agenda.jobs({name: 'fetch restarted builds'}, {_id: -1}, 1);
        const lastJobs = await agenda.jobs({name: 'fetch restarted jobs'}, {_id: -1}, 1);
        res.json({
            build: lastBuilds[0],
            job: lastJobs[0],
        });
    });

    app.get("/api/builds", async function (req, res) {
        const builds = await buildsCollection.find({ $where : "this.old.state != this.new.state"}).toArray();
        res.json(builds);
    });

    app.get("/api/build/:id", async function (req, res) {
        res.json(await buildsCollection.aggregate([
            {
                '$match': {
                    'id': parseInt(req.params.id)
                }
            },
            {
              '$lookup': {
                'from': 'jobs', 
                'localField': 'old.job_ids', 
                'foreignField': 'id', 
                'as': 'jobs'
              }
            }, {
              '$lookup': {
                'from': 'logs', 
                'localField': 'old.job_ids', 
                'foreignField': 'id', 
                'as': 'logs'
              }
            }
          ]).limit(1).next());
    });

    app.get("/api/job/diff/:id", async function (req, res) {
        const jobId = parseInt(req.params.id)
        const newResult = await logCollection.findOne({"id": jobId})
        if (newResult == null) {
            return res.status(404).send().end()
        }
        const oldResult = await buildSaverLogCollection.findOne({"id": jobId})
        if (oldResult == null) {
            return res.status(404).send().end()
        }
        const newLog = cleanLog(newResult.log)
        const oldLog = cleanLog(oldResult.log)
        const diffs = dmp.diff_lineMode(oldLog, newLog);
        const lines = []
        for (let diff of diffs) {
            let op = ' ';
            if (diff[0] == -1) {
                op = '-'
            } else if (diff[0] == 1) {
                op = '+'
            }
            const ll = diff[1].split('\n')
            for (let l of ll) {
                lines.push(op + l)
            }
        }
        const output = []
        for (let line of lines) {
            if (line[0] != '-') {
                continue
            }
            if (lines.indexOf('+'+line.substring(1)) > -1) {
                continue;
            }
            output.push(line.substring(1))
        }
        res.type('txt')
        res.set('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
        return res.send(output.join('\n')).end()
    })

    app.get("/job/:id", async function (req, res) {
        const jobId = parseInt(req.params.id)
        const result = await buildSaverLogCollection.findOne({"id": jobId})
        if (result) {
            res.send(cleanLog(result.log)).end()
        } else {
            res.status(404).send().end()
        }
    })

    app.get('/api/stat/', async function (req, res) {
        const results = await stat(buildsCollection, jobsCollection)
        res.json(results);
    })
})()

async function graceful() {
    console.log('exit')
    await agenda.stop();
    await client.close();
    process.exit(0);
}

process.on('exit', graceful);
process.on('SIGINT', graceful);
process.on('SIGUSR1', graceful);
process.on('SIGUSR2', graceful);
process.on('uncaughtException' , graceful);
