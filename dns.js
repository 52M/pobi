var debug = require('debug')('DNS')
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

function isGfw(domain){
  var self = this;
  for (var i=0; i<self.gfw.length; i++){
    if (endsWith(domain, self.gfw[i])) return true;
  }
  return false;
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

function endsWith(str, postfix){
  if (str.length < postfix.length) return false;
  return postfix == str.substr(str.length - postfix.length, postfix.length);
}

function start(config){
  // init
  var port = config.port || 53; // dns must on 53
  var host = config.host || '127.0.0.1';
  var upstream = {
    address: config.upstream.host || '8.8.8.8',
    port: config.upstream.port || 53,
    type: config.upstream.protocol || 'udp'
  };
  var gfw = config.gfw || ['twitter.com','facebook.com'];
  var wpad = config.wpad || '127.0.0.1';
  //
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
    } else if(q['type'] == 1 && q['class'] == 1 && isGfw.call(this, d)) {
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

  var udpServer = ndns.createServer();
  udpServer.upstream = upstream;
  udpServer.gfw = gfw;
  udpServer.wpad = wpad;
  udpServer.on('listening', onListening);
  udpServer.on('request', onRequest);
  udpServer.on('close', onClose);
  udpServer.on('error', onError);
  udpServer.serve(port, host);
  var tcpServer = ndns.createTCPServer();
  tcpServer.upstream = upstream;
  tcpServer.gfw = gfw;
  tcpServer.wpad = wpad;
  tcpServer.on('listening', onListening);
  tcpServer.on('request', onRequest);
  tcpServer.on('close', onClose);
  tcpServer.on('error', onError);
  tcpServer.serve(port, host);
}

exports.start = start;

// ----
/*
if(!module.parent) {
  start({port:53});
}
*/
