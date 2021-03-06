const proxy = require('express-http-proxy')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const methodOverride = require('method-override')
const express = require('express')
const app = express();
const server = require('http').Server(app);
const WebSocket = require('ws');
const os = require('os');

const serverStat = require('./server_stat')

app.use('/', express.static(__dirname + '/static'));

var port = process.env.PORT || 4000;

app.use(cookieParser());
app.use(bodyParser());
app.use(methodOverride('X-HTTP-Method-Override'));
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "PUT, GET, POST, DELETE, OPTIONS");
  next();
});

const wssServer = new WebSocket.Server({ server });
serverStat.monitorWebSocket(wssServer)

wssServer.on('connection', function connection(ws) {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);
});

setInterval(function ping() {
    wssServer.clients.forEach(client => {
        if (client.isAlive === false) {
            return client.terminate();
        }
        client.isAlive = false;
        client.ping(() => {});
    });
}, 30000);


wssServer.broadcast = function broadcast(data) {
    wssServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data, error => {
                if (error) {
                    console.error(error);
                }
            });
        }
    });
};

function selectProxyHost (request) {
    let url = request.url.substring(1, request.url.length);
    const indexService = url.indexOf('/')
    if (indexService > -1) {
        url = url.substring(0, indexService)
    }
    return url;
}
app.use('/r/', proxy(selectProxyHost, {
    memoizeHost: false,
    parseReqBody: false,
    proxyReqPathResolver: function (req) {
        let url = req.url.substring(1, req.url.length);
        const indexService = url.indexOf('/')
        url = url.substring(indexService, url.length)
        return url;
    },
}));

function startListenerConnection() {
    try {
        const wsClient = new WebSocket('ws://listener');
        wsClient.on('error', function(){
            return setTimeout(startListenerConnection, 250);
        })
        wsClient.on('message', function incoming(data) {
            wssServer.broadcast(data)
        });
        var that = this;
        wsClient.on('open', function(){
            console.log("Connect to listener")
            that.isAlive = true;
        })
        wsClient.on('ping', function(){
            that.isAlive = true;
        })
        wsClient.on('close', function(){
            that.isAlive = false;
            // Try to reconnect in 5 seconds
            return setTimeout(startListenerConnection, 250);
        });
    } catch (e) {
        return setTimeout(startListenerConnection, 250);
    }
}


server.listen(port, function () {
    var port = server.address().port;
    console.log('App running on port ' + port);
    startListenerConnection();
});