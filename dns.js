var url = require('url')
  , d = require('domain').create()
  , debug = require('./debug')('DNS')
  , isGfw = require('./gfw').isGfw
  , ndns = require('native-dns');

var wpad_domain = 'wpad';
var timeout = 2000;

function query(q, cb){
  var self = this;
  var result = [];
  var ureq = ndns.Request({
    question: q,
    server: self.upstream,
    timeout: timeout
    // cache: false
  });
  ureq.on('timeout', function(){
    debug('forward timeout');
    cb('ETIMEOUT');
  });
  ureq.on('message', function (e, r) {
    r.answer.forEach(function (a) { result.push(a); });
  });
  ureq.on('end', function () {
    cb(null, result);
  });
  ureq.send();
}

function queryGfw(domain, cb){
  var self = this;
  var result = [];
  var ureq = ndns.Request({
    question: { name:domain, type:1, class:1 },
    server: self.upstream,
    timeout: timeout,
    obstruct: true // to drop obstruct packet from gfw
    // cache: false
  });
  ureq.on('timeout', function(){
    debug('forward timeout');
    cb('ETIMEOUT');
  });
  ureq.on('message', function (e, r) {
    r.answer.forEach(function (a) { result.push(a.address); });
  });
  ureq.on('end', function () {
    cb(null, result);
  });
  ureq.send();
}

function startsWith(str, prefix){
  return prefix == str.substr(0,prefix.length);
}

// ----

var udpServer = null;
var tcpServer = null;

function start(config){
  var onListening = function(){
    debug("listening on %j", this.address());
  };
  var onRequest = function(req, res){
    var self = this;
    req.ip = req._socket._remote.address;
    var q = req.question[0];
    var d = q.name;
    if(q['type'] == 1 && q['class'] == 1 && startsWith(d,wpad_domain)) {
      // resolve WPAD name
      res.answer.push(ndns.A({name:wpad_domain, address:self.wpad, ttl:600}));
      res.send();
      debug("%s: Query [WPAD] %j -> %j", req.ip, d, [self.wpad]);
    } else if(q['type'] == 1 && q['class'] == 1 && isGfw(d)) {
      queryGfw.call(this, d, function(e,r){
        if(e) {
          debug("%s: Query [GFW] %j : %j", req.ip, d, e);
	  res.header.rcode = ndns.consts.NAME_TO_RCODE.NOTFOUND;
        } else {
          r.forEach(function(ip){
            res.answer.push(ndns.A({ name: d, address: ip, ttl: 300 }));
          });
        }
        res.send();
        debug("%s: Query [GFW] %j -> %j", req.ip, d, r);
      });
    } else {
      query.call(this, q, function(e,r){
        if(e) {
          debug("%s : Query %j : %j", req.ip, q, e);
	  res.header.rcode = ndns.consts.NAME_TO_RCODE.NOTFOUND;
        } else {
          res.answer = r;
        }
        res.send();
        debug("%s: Query %j -> %j", req.ip, q, r);
      });
    }
  };
  var onClose = function(){
    debug("closed %j", this.address());
  };
  var onError = function(err, buff, req, res){
    debug("error", err, buff, req, res);
  }

  // init
  udpServer = ndns.createServer();
  udpServer.on('listening', onListening);
  udpServer.on('request', onRequest);
  udpServer.on('close', onClose);
  udpServer.on('error', onError);

  tcpServer = ndns.createTCPServer();
  tcpServer.on('listening', onListening);
  tcpServer.on('request', onRequest);
  tcpServer.on('close', onClose);
  tcpServer.on('error', onError);

  var o = url.parse(config.upstream);
  var upstream = {
    type: (o.protocol == "tcp:") ? 'tcp' : 'udp',
    address: o.hostname || '8.8.8.8',
    port: o.port || 53
  };
  var wpad = config.wpad || '127.0.0.1';

  udpServer.upstream = upstream;
  udpServer.wpad = wpad;

  tcpServer.upstream = upstream;
  tcpServer.wpad = wpad;

  var o = url.parse(config.url);
  var host = o.hostname || '0.0.0.0';
  var port = o.port || 53; // dns must on 53

  d.on('error', function(e){
    // debug('ERROR', e, e.stack);
    debug('!!!! ERROR %s', e.message);
  });
  d.run(function(){
    udpServer.serve(port, host);
    tcpServer.serve(port, host);
  });
}
exports.start = start;

function stop(){
  udpServer.close();
  tcpServer.close();
}
exports.stop = stop;