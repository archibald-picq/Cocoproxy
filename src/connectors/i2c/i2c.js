

var PubSub = require('../../utils/pubsub');
var reldate = require('../../utils/reldate');
var mpu6050 = require('./module/mpu6050/mpu6050');
var coco = require('./module/coco/coco');
var Q = require('q');
var pub = new PubSub();
var clients = {};
var i2c = null,
	wire = null;
var DEVICE_POLLING_INTERVAL = 100;
var lastEvent = 0;
try {
	i2c = require('i2c');
// var wireSlave = new i2c(0x6f, {device: '/dev/i2c-1', debug: false});
}
catch(e) {
	console.warn('No i2c support');
}






if (i2c) {
	setTimeout(function() {
		var lastScan = null;
		var lastScanIds = '';
		
		console.info('open i2c port ...');
		wire = new i2c(0, {device: '/dev/i2c-1', debug: false});
		
		wire.on('data', function(data) {
			console.info('onData: ', data);
		});
		
		(function	loop() {
			try {
				if (!lastScan || lastScan < new Date() - 10000) {
					// console.warn('scanning ...');
					wire.scan(function(err, data) {
						if (err) {console.warn('cant scan i2c bus ', err); return;};
						if (data.join('|') !== lastScanIds) {
							lastScanIds = data.join('|');
							console.info(data);
						}
						
						for (var i=0; i<data.length; i++)
							if (data[i])
								create_or_update_client(data[i]);
							else
								console.warn('received invalid device ', data[i]);
						
						for (var addr in clients)
							if (clients.hasOwnProperty(addr) && data.indexOf(clients[addr].address) == -1) {
								log_client(clients[addr], 'not detected any more');
								// log_client(clients[addr], 'client lost');
								if (clients[addr].module)
									clients[addr].module.destroy();
								clients[addr].trigger('close');
								// pubClient.broadcast({clientLost: addr});
								delete clients[addr];
							}
								
								
					});
				}
				else {
					for (var addr in clients)
						if (clients.hasOwnProperty(addr))
							create_or_update_client(clients[addr]);
				}
			}
			catch(e) {
				console.warn(e, e.stack);
			}
			setTimeout(loop, 2000);
		})();
	}, 1);
}

function	create_or_update_client(addr) {
	if (!clients[addr]) {
		clients[addr] = newClient(addr);
		console.info('++ new i2c client detected 0x'+addr.toString(16));
		pub.trigger('device', clients[addr]);
		// broadcast({newClient: dump_client()});
		
	}
	var client = clients[addr];
	// timeout ?
}

function	log_client() {
	var args = arguments;
	var client = Array.prototype.shift.apply(args);
	
	var prefix = client.address.toString(16);
	if (prefix.length < 2)
		prefix = '0'+prefix;
	prefix = '0x'+prefix;
	var append = '';
	if (client.name)
		append += (append? ', ': '')+client.name;
	// if (client.build)
		// append += (append? ', ': '')+'build: '+client.build;
	if (client.drift)
		append += (append? ', ': '')+'drift: '+client.drift;
	if (append)
		prefix += ' ('+append+')';
	
	Array.prototype.unshift.apply(args, [prefix]);
	Array.prototype.unshift.apply(args, [log_date()+':']);
	console.info.apply(console.info, args);
	if (lastEvent) {
		clearTimeout(lastEvent);
	}
	lastEvent = setTimeout(function() {
		console.info('.');
	}, 5000);
}
function	log_date() {
	var n = new Date();
	var ms = n.getMilliseconds();
	while ((''+ms).length < 3)
		ms = '0'+ms;
	return (n.getHours() < 10? '0': '')+n.getHours()+':'+(n.getMinutes() < 10? '0': '')+n.getMinutes()+':'+(n.getSeconds() < 10? '0': '')+n.getSeconds()+'.'+ms;
}

function	is_recent(sensor) {
	return sensor.prevChange > sensor.currentChange - 1000;
}
function	is_major(sensor) {
	return sensor.value < sensor.prevValue * 0.8 || sensor.value > sensor.prevValue * 1.2;
}

function	dumpSensors(client) {
	var s = {};
	for (var i in client.sensors)
		if (client.sensors.hasOwnProperty(i))
			s[i] = client.sensors[i].value;
	return s;
}

function	diff_sensors(client, newValue) {
	var sensors = client.sensors;
	var now = new Date();
	
	/**
	 * digital devices
	 */
	var change = false;
	for (var id in newValue)
		if (newValue.hasOwnProperty(id) && sensors[id]) {
			if (sensors[id].value !== newValue[id]) {
				sensors[id].value = newValue[id];
				change = true;
				// log_client(client, id+' changed to ', sensors[id].value);
				if (sensors[id].change)
					sensors[id].change();
			}
		}
	if (change) {
		var packet = {sensorsUpdate: {}};
		packet.sensorsUpdate[client.address] = dumpSensors(client);
		client.trigger('sensors', packet);
		// broadcast(packet);
	}
}
function	newClient(addr) {
	var pubClient = new PubSub();
	var client = new i2c(addr, {device: '/dev/i2c-1', debug: false});
	client.transport = 'i2c';
	client.sensors = {

	};
	client.on = pubClient.on;
	client.unbind = pubClient.unbind;
	client.trigger = pubClient.trigger;
	client.clearAllListeners = pubClient.clearAllListeners;
	client.clearListeners = pubClient.clearListeners;
	client.getUniqId = function() {
		return addr;
	};
	client.dump = function() {
		var obj = {address: client.address};
		
		if (client.name)
			obj.name = client.name;
		if (client.type)
			obj.type = client.type;
		if (client.build)
			obj.build = client.build;
		if (client.boottime)
			obj.boottime = client.boottime;
		
		var sensors = (function(sensors) {
			var s = {};
			for (var i in sensors)
				if (sensors.hasOwnProperty(i))
					s[i] = {name: sensors[i].name, value: sensors[i].value, type: sensors[i].type};
			return s;
		})(client.sensors);
		
		if (Object.keys(sensors).length)
			obj.sensors = sensors;
		return obj;
	};
	client.getSensor = function(code) {
		// console.warn('search for seansor ', code);
		return client.sensors[code];
	};
	client.detect = function detect() {
		log_client(client, '> detecting device');
		var deferred = Q.defer();
		
		mpu6050.detect(client)
			.then(function(module) {
				client.module = module;
				client.trigger('update');
				pub.trigger('update', client);
				deferred.resolve();
			}, function() {
				coco.detect(client)
					.then(function(module) {
						client.module = module;
						// console.info('device detected as ', client);
						client.trigger('update');
						pub.trigger('update', client);
						deferred.resolve();
					}, function() {
						console.warn('dont know what is it');
						deferred.reject();
					});
			});
		return deferred.promise;
	};
	client.log = function() {
		var args = arguments;
		Array.prototype.unshift.apply(args, [client]);
		log_client.apply(client, args);
	};
	return client;
}

function	resp_checksum(buffer) {
	var chk = 0;
	for (var i = 0; i < buffer.length; i++) {
		chk += (buffer[i] % 256);
		chk %= 256;
	}
	return chk % 42;
}


module.exports = function(config) {
	console.info('export herre');
	return {
		on: pub.on,
		unbind: pub.unbind,
		trigger: pub.trigger,
		clearAllListeners: pub.clearAllListeners,
		clearListeners: pub.clearListeners,
	};
};