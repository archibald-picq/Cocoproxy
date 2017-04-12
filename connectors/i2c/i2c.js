

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
				if (!lastScan || lastScan < new Date() - 5000) {
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
	
	var prefix = '0x'+client.address.toString(16);
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
	return (n.getHours() < 10? '0': '')+n.getHours()+':'+(n.getMinutes() < 10? '0': '')+n.getMinutes()+':'+(n.getSeconds() < 10? '0': '')+n.getSeconds()+'.'+n.getMilliseconds();
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
						console.info('device detected as ', client);
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

	
	
	// // console.info('do nothing with i2c client ', client.address);
	// return;
	
	// // if (addr != 9)
	// if (!client.name) {
		// log_client(client, 'ask name to '+client.address);
		// ask_property(client, 'name', function(err, res) {
			// if (err) {console.warn(err); return;}
			// log_client(client, '> received "', res, '"');
			// clients[addr].name = res;
			// client.trigger('update');
			// log_client(client, '> named \'', clients[addr].name, '\'');
			// then();
		// });
	// }
	// else
		// then();
	
	// function	then() {
		
		// // if (!client.build) {
			// // log_client(client, 'ask build to '+client.address);
			// // ask_property(client, 'build', function(err, res) {
				// // if (err) {console.warn(err); return;}
				// // client.build = res;
				// // client.trigger('update');
				// // log_client(client, '> is build \''+res+'\'');
				// // then2();
			// // });
		// // }
		// // else
			// then2();
	// }
	
	// function	then2() {
		// // if (!client.boottime) {
			// // log_client(client, 'ask boottime to '+client.address);
			// // ask_property(client, 'boottime', function(err, res) {
				// // if (res && client.boottime && res < client.boottime) {
					// // log_client(client, '> has REbooted '+res+' < '+client.boottime);
					// // client.build = null;
					// // client.name = null;
				// // }
				// // client.boottime = res;
				// // client.trigger('update');
				// // var d = new Date();
				// // d.setTime(d.getTime()-res);
				// // log_client(client, '> has booted '+reldate(res)+' ago (at '+d+')');
				// // then3();
			// // });
		// // }
		// // else
			// then3();
	// }
	
	// function	then3() {
		// return;
		
		// // log_client(client, 'register to client stream ', client);
		// if (!client.eventRegistered) {
			// try {
				// client.eventRegistered = true;
				// log_client(client, 'register to client stream');
				
				// client.eventPoller = (function	poll() {
					// // if (!poll.poller)
						// // poll.poller	= {tm:true};
					// var poller	= {tm:true};
					// ask_property(client, 'state', function(err, res) {
						// if (err) {
							// log_client(client, err);
							// console.info('client lost');
							// if (clients[addr].module)
								// clients[addr].module.destroy();
							// clients[addr].trigger('close');
							// // broadcast({clientLost: addr});
							// delete clients[addr];
							// // poller.tm = setTimeout(poll, DEVICE_POLLING_INTERVAL);
							// return ;
						// }
						// try {
							// // log_client(client, 'resp: ', res);
							// diff_sensors(client, res);
						
						// }
						// catch(e) {
							// console.warn(e);
						// }
						// poller.tm = setTimeout(poll, DEVICE_POLLING_INTERVAL);
					// });
					// return poller;
				// })();
				
				// // client.setAddress(addr);
				// // client.on('data', function(resp) {
					// // try {
						// // // log_client(client, 'resp: ', resp);
						// // diff_sensors(client, resp.data[1]);
					  // // // result for continuous stream contains resp buffer, address, length, timestamp
					// // }
					// // catch(e) {
						// // console.info(e);
					// // }
				// // });
				
				// // log_client(client, 'stream from ', client);
				// // client.stream(45, 2, 100); // continuous stream, delay in ms
				// // log_client(client, 'streaming from ', client);
			// }
			// catch(e) {
				// console.warn(e);
			// }
		// }
	// }
// }

// function	set_property(client, values, cb) {
	// var nextValue = {
		// d1: typeof values.d1 != 'undefined'? values.d1: client.sensors.d1.value,
		// d2: typeof values.d2 != 'undefined'? values.d2: client.sensors.d2.value,
		// d3: typeof values.d3 != 'undefined'? values.d3: client.sensors.d3.value,
		// d4: typeof values.d4 != 'undefined'? values.d4: client.sensors.d4.value,
		// d5: typeof values.d5 != 'undefined'? values.d5: client.sensors.d5.value,
		// d6: typeof values.d6 != 'undefined'? values.d6: client.sensors.d6.value,
		// d7: typeof values.d7 != 'undefined'? values.d7: client.sensors.d7.value,
		// d8: typeof values.d8 != 'undefined'? values.d8: client.sensors.d8.value,
	// };
	// var value = 0;
	// if (nextValue.d1)
		// value += 0x01;
	// if (nextValue.d2)
		// value += 0x02;
	// if (nextValue.d3)
		// value += 0x04;
	// if (nextValue.d4)
		// value += 0x08;
	// if (nextValue.d5)
		// value += 0x10;
	// if (nextValue.d6)
		// value += 0x20;
	// if (nextValue.d7)
		// value += 0x40;
	// if (nextValue.d8)
		// value += 0x80;
	// log_client(client, 'send command '+properties.relay.code+' with value '+value+' from ', values);
	// client.writeBytes(properties.relay.code, [value, value], function(err, res) {
		// if (err) {log_client(client, err); cb(err); return ;}
		// log_client(client, 'order sent, got ', res);
		// client.readBytes(42, 2, function(err, res) {
			// if (err) {log_client(client, err); cb(err); return ;}
			// log_client(client, 'set_bitmask response received ', res);
			// if (res[0] == 1 || res[0] == 0) {
				// if (client.error)
					// log_client(client, '    => retry with success');
				// delete client.error;
				// // console.info(client.address+' > [', res, '] ('+properties[name].convert(res)+')');
				// for (var i in values)
					// if (values.hasOwnProperty(i))
						// client.sensors[i].value = values[i];
				// cb();
			// }
			// else {
				// if (!client.error)
					// client.error = 0;
				// client.error++;
				// if (client.error > 5) {
					// log_client(client, 'Unsupported response ', res, '');
					// cb({message: 'Error sending command '+value});
				// }
				// else
					// set_property(client, values, cb);
			// }
		// });
		
	// });
// }

function	resp_checksum(buffer) {
	var chk = 0;
	for (var i = 0; i < buffer.length; i++) {
		chk += (buffer[i] % 256);
		chk %= 256;
	}
	return chk % 42;
}


// function	set_sensor_value(value) {
	// var newValue = {};
	// newValue[params.code] = params.value;
	// set_property(clients[params.address], newValue, function() {
		// deferred.resolve(true);
		// log_client(clients[params.address], 'relay changed');
	// });
// }



module.exports = function(config) {
	return {
		on: pub.on,
		unbind: pub.unbind,
		trigger: pub.trigger,
		clearAllListeners: pub.clearAllListeners,
		clearListeners: pub.clearListeners,
	};
};