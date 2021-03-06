const request = require('request')

module.exports = function(agenda, restartedDB, buildsaverDB) {
    const buildsCollection = restartedDB.collection('builds')
    const jobsCollection = restartedDB.collection('jobs')
    const logCollection = restartedDB.collection('logs')

    const jobsBuildsaverCollection = buildsaverDB.collection('jobs')
    const logBuildsaverCollection = buildsaverDB.collection('logs')


    function saveLog(jobId) {
        return new Promise(async resolve => {
            const log = await logCollection.findOne({"id": jobId});
            const oldLog = await logBuildsaverCollection.findOne({"id": jobId});
            if (!log && oldLog) {
                request('https://api.travis-ci.org/jobs/' + jobId + '/log', function (err, resp, body) {
                    if (body != null && body.length > 0) {
                        if (body[0] == '{') {
                            console.log(body)
                        }
                        // body = stripAnsi(body)
                        logCollection.insertOne({
                            id: jobId,
                            //diff: jsdiff.createPatch('log', oldLog.log, body),
                            log: body
                        }, err => {
                            resolve(jobId)
                        })
                    } else {
                        resolve(jobId)
                    }
                })
            } else {
                resolve(jobId)
            }
        })
    }

    async function getJobsFromIds(buildIds) {
        return new Promise((resolve, reject) => {
            request.get('http://listener/api/jobs?id=' + buildIds.join(','), {timeout: 15000}, function (err, res, body) {
                if (err) {
                    return reject(err);
                }
                const items = JSON.parse(body);
                items.forEach(i => {
                    if (i.started_at) {
                        i.started_at = new Date(i.started_at)
                    }
                    if (i.updated_at) {
                        i.updated_at = new Date(i.updated_at)
                    }
                    if (i.finished_at) {
                        i.finished_at = new Date(i.finished_at)
                    }
                });
                resolve(items);
            })
        });
    };

    async function getNewJobs(jobs) {
        const restartedJobs = []
        const jobObj = {};
        for (let job of jobs) {
            jobObj[job.id] = job
            if (job.config && job.config['.result']) {
                job.config.result = job.config['.result']
                delete job.config['.result'];
            }
        }
        let newJobs = []
        try {
            newJobs = await getJobsFromIds(Object.keys(jobObj));    
        } catch (error) {
            newJobs = await getJobsFromIds(Object.keys(jobObj));
        }
        for (let job of newJobs) {
            delete job.commit;
            
            if (jobObj[job.id].started_at < job.started_at && job.state != 'started') {
                restartedJobs.push({
                    id: job.id,
                    wait_time: job.started_at - jobObj[job.id].started_at,
                    old: jobObj[job.id],
                    new: job
                });
            }
        }
        return restartedJobs;
    }

    agenda.define('fetch restarted jobs', {concurrency: 1}, async job => {
        let currentJobsID = []

        // [
        //     {
        //     '$lookup': {
        //         'from': 'jobs', 
        //         'localField': 'old.job_ids', 
        //         'foreignField': 'id', 
        //         'as': 'jobs'
        //     }
        //     }, {
        //     '$match': {
        //         'jobs': {
        //         '$eq': []
        //         }
        //     }
        // }]
        const cursor = buildsCollection.find({}, {projection: {id: 1, old: 1}}).sort( { _id: -1 } );

        const nbBuilds = await cursor.count()

        let count = 0
        let countRestarted = 0
        const checked = new Set()
        
        while ((build = await cursor.next())) {
            count++;
            if (checked.has(build.id)) {
                continue
            }
            checked.add(build.id)
            for (let jobId of build.old.job_ids) {
                await job.touch();
                const currentJob = await jobsCollection.findOne({id: jobId});
                if (currentJob != null) {
                    const currentLog = await logCollection.findOne({id: jobId});
                    if (currentLog == null) {
                        await saveLog(jobId)
                    }
                    // job exist skip
                    continue
                }
                currentJobsID.push(jobId)

                if (currentJobsID.length >= 200) {
                    const savedJobs = await jobsBuildsaverCollection.find({$or: currentJobsID.map(id => {return {id: id}})}).toArray()
                    try {
                        const newJobs = await getNewJobs(savedJobs);
                        if (newJobs.length > 0) {
                            countRestarted += newJobs.length
                            console.log('Restarted jobs:', countRestarted)
                            await jobsCollection.insertMany(newJobs)
                            for (let j of newJobs) {
                                await saveLog(j.id)
                                await job.touch();
                            }
                            job.attrs.progression = {index: count, total: nbBuilds, countRestarted}
                            await job.save();
                        }
                    } catch (error) {
                        // ignore
                        console.error(error)
                    }
                    currentJobsID = []
                }
            }
            job.attrs.progression = {index: count, total: nbBuilds, countRestarted}
            await job.save();
        }
        
        if (currentJobsID.length > 0) {
            const savedJobs = await jobsBuildsaverCollection.find({$or: currentJobsID.map(id => {return {id: id}})}).toArray()

            const newJobs = await getNewJobs(savedJobs);
            if (newJobs.length > 0) {
                countRestarted += newJobs.length
                try {
                    await jobsCollection.insertMany(newJobs)
                } catch (error) {
                    // ignore
                    console.error(error)
                }
                for (let job of newJobs) {
                    await saveLog(job.id)
                    await job.touch();
                }
            }
        }
    });
};