// var serialport = require('serialport');
var config = require('./package');
console.info('Loading Coconut '+config.version+' ...');

var Q = require('q');
var HTTP_PORT = 8080;

var manager = require('./src/device-manager');

var i2c = require('./connectors/i2c/i2c')(config);
i2c.on('device', function(device) {
	// console.info('i2c device: ', device.dump());
	manager.add(device);
});

// var serial = require('./connectors/serial/serial')(config);
// serial.on('device', function(device) {
	// // console.info('serial device: ', device.dump());
	// manager.add(device);
// });

manager.on('device', function(device) {
	// console.info('manager: ', device);
	
	device.on('close', function() {
		console.info('device.close: ', device.getUniqId());
		broadcast({clientLost: device.getUniqId()})
		manager.remove(device);
	});
	device.on('update', function() {
		broadcast({clientUpdate: device.dump()});
	});
	
	device.on('sensors', function(packet) {
		// console.info('sensor update: ', packet, ' for ', httpClients.length, ' clients');
		broadcast(packet);
	});
	// console.info('broadcast newClient(', device.dump(), ')');
	broadcast({newClient: device.dump()});
});

// i2c.run();
// serial.run();

// function	dump_client(client) {
	// return {
		// name: client.name,
		// address: client.address,
		// build: client.build,
		// boottime: client.boottime,
		// sensors: (function(sensors) {
			// var s = {};
			// for (var i in sensors)
				// if (sensors.hasOwnProperty(i))
					// s[i] = {name: sensors[i].name, value: sensors[i].value};
			// return s;
		// })(client.sensors),
	// };
// }

console.info('Initialize HTTP server ...');
var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var httpClients = [];
var commands = {
	currentDevices: function() {
		var deferred = Q.defer();
		var cls = [];
		var devices = manager.getDevices();
		for (var i=0; i<devices.length; i++)
			cls.push(devices[i].dump());
		deferred.resolve({currentDevices: cls});
		return deferred.promise;
	},
	setValue: function(ws, params) {
		// console.info('call setValue with ', params);
		var deferred = Q.defer();
		
		var client = null,
			sensor = null;
		
		if (!(client = manager.getDevice(params.address)))
			deferred.reject('client '+params.address+' not detected yet');
		else if (!(sensor = client.getSensor(params.code)))
			deferred.reject('client '+params.address+' doesnt have sensor '+params.code);
		else {
			sensor.setValue(params.value)
				.then(function(res) {
					deferred.resolve(res);
				}, function(err) {
					deferred.reject(err);
				});
		}
		
		return deferred.promise;
	},
	askName: function(ws, params) {
		var deferred = Q.defer();
		
		var client = null;
		
		if (!(client = manager.getDevice(params.address)))
			deferred.reject('client '+params.address+' not detected yet');
		else {
			// if (!client.askName) {
				console.info('bad object ', client);
			// }
			client.askName()
				.then(function(res) {
					deferred.resolve(res);
				});
		}
		
		return deferred.promise;
	},
	askEvents: function(ws, params) {
		var deferred = Q.defer();
		
		var client = null;
		
		if (!(client = manager.getDevice(params.address)))
			deferred.reject('client '+params.address+' not detected yet');
		else {
			client.askEvents()
				.then(function(res) {
					deferred.resolve(res);
				});
		}
		
		return deferred.promise;
	},
	clearEvents: function(ws, params) {
		var deferred = Q.defer();
		
		var client = null;
		
		if (!(client = manager.getDevice(params.address)))
			deferred.reject('client '+params.address+' not detected yet');
		else {
			client.clearEvents()
				.then(function(res) {
					deferred.resolve(res);
				});
		}
		
		return deferred.promise;
	},
};
app.ws('/', function(ws) {
	console.info('ws open');
	httpClients.push(ws);
	ws.on('message', function(msg) {
		var obj;
		try {
			obj = JSON.parse(msg);
		}
		catch(e) {
			ws.send(JSON.stringify({response: 'Unparsable payload "'+msg+'"'}));
			return;
		}
		var command = obj.command;
		
		if (commands[command]) {
			console.log('ws command: ', obj);
			commands[command](ws, obj.params || {})
				.then(function(data) {
					console.info('ws command', obj, 'returns:', data);
					ws.send(JSON.stringify({response: data}));
					console.info('then ?');
					return null;
				}, function(e) {
					console.info('fail ', e);
				})
				.catch(function(e) {
					console.info('exception: ', e, e.stack);
					ws.send(JSON.stringify({response: e.message}));
				})
				.done();
		}
		else {
			ws.send(JSON.stringify({response: 'Unsupported command "'+command+'"'}));
		}
	});
	ws.on('close', function() {
		var p = httpClients.indexOf(ws);
		if (p != -1)
			httpClients.splice(p, 1);
		console.info('ws close');
	});
});

function	broadcast(obj) {
	var s = JSON.stringify(obj);
	for (var i = 0; i < httpClients.length; i++) {
		try {
			httpClients[i].send(s);
		}
		catch(e) {
			console.warn(e);
		}
	}
}

function	getGuiRoot() {
	var match;
	for (var i=0; i<process.argv.length; i++) {
//		console.info('check "'+process.argv[i]+'"');
		if ((match = process.argv[i].match(/^--gui=.*$/))) {
//			console.info('found gui path "', match, '"');
			var path = match[0].replace('--gui=', '')
//			console.info('returns "'+path+'"');
			return path;
			
//			return match[1];
		}
	}
	return __dirname+'/htdocs';
}

var webRoot = getGuiRoot();

app.use('/', express.static(webRoot));

app.use('/bower_components/', express.static(__dirname+'/bower_components/'));

app.all('/*', function(req, res, next) {
	if (req.originalUrl.indexOf('/bower_components') !== -1)
		return next();
	// Just send the index.html for other files to support HTML5Mode
	res.sendFile('index.html', { root: webRoot });
});

app.use(function(req, res, next) {
	res.status(404).send('not found');
});

app.listen(HTTP_PORT, function() {
	console.log(config.name + ' v' + config.version + ' is listening on port ' + HTTP_PORT + ' serving files from ' + webRoot);
});



