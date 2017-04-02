'use sctrict';

var Q = require('q');
var buffer = require('../../../../utils/buffer');
var DEVICE_POLLING_INTERVAL = 50;

var DIGITAL_OUT = 0x01;		// for led, light, on/off purpose
var DIGITAL_OUT_TWO_WAY = 0x02;	// for motor with 1 speed in both directions
var DIGITAL_OUT_THREE_WAY = 0x03;	// for traffic light
var DIGITAL_IN = 0x04;		// for switch button, on/off purpose
var ANALOG_IN = 0x05;
var ANALOG_OUT = 0x06;
var COMMAND_CONTINUE_BUFFER = 1;
var COMMAND_SEND_MAGIC = 2;
var COMMAND_VARIABLE_LENGTH = 3;
var COMMAND_SEND_DEVICE_NAME = 4;
var COMMAND_SEND_BOOT_TIME = 5;
var COMMAND_SEND_BUILD_TIME = 6;
var COMMAND_SEND_EVENT_QUEUE = 7;
var COMMAND_CLEAR_EVENT_QUEUE = 8;
var COMMAND_SET_NAME = 9;
var COMMAND_SEND_MODULE_DEF = 10;
var COMMAND_SET_MODULE_VALUE = 11;

var COMMAND_RESPONSE_OK = 1;
var COMMAND_RESPONSE_MAGIC = 42;

function	findByKey(array, search, keyName) {
	for (var i=0; i<array.length; i++)
		if (array[i] && array[i][keyName] === search)
			return array[i];
	return null;
}

var compiledModules = [
	{
		code: 0x01,
		name: 'Button',
		type: DIGITAL_IN,
		convert: function(buffer) {
			// console.info('convert ', buffer);
			return !!buffer[0];
		}
	},
	{
		code: 0x02,
		name: 'Relay',
		type: DIGITAL_OUT,
		convert: function(buffer) {
			// console.info('convert ', buffer);
			return !!buffer[0];
		},
		serialize: function(bool) {
			return [bool? 0x01: 0x00];
		}
	},
	{
		code: 0x03,
		name: 'PowerMeter',
		type: ANALOG_IN,
		convert: function(buffer) {
			return buffer[1] << 8 | buffer[0];
		}
	},
	{
		code: 0x04,
		name: 'StatusLeds',
		type: DIGITAL_OUT_THREE_WAY,
		convert: function(buffer) {
			return null;
		}
	},
];

function	parseEvents(buffer) {
	var i = 0;
	var count = 0;
	var size;
	var events = [];
	while (i < buffer.length) {
		/**
		 * packets are sent this way
		 *
		 * +----------+----------+---------------------------------+----------+----------+------
		 * |  payload | instance |             payload             |  payload | instance |      
		 * |   size   |          |                                 |   size   |          |   ...
		 * +----------+----------+---------------------------------+----------+----------+------
		 * |  4 bits  |  4 bits  |      variable size payload      |  4 bits  |  4 bits  |   ...
		 * +----------+----------+---------------------------------+----------+----------+------
		 * |      mandatory      |             optional            |      mandatory      |   ...
		 * +----------+----------+---------------------------------+----------+----------+------
		 */
		var instance = buffer[i] & 0x0F;
		var size = (buffer[i] & 0xF0) >> 4;
		// console.info('buffer instance: '+instance+', size: '+size);
		events.push({
			instance: instance,
			value: buffer.slice(i+1, i+1+size),
		});
		i += 1 + size;
	}
	
	return events;
}

function coconode(client) {
	client.log('create instance of coconode for client', client);
	client.type = 'coco';
	client.askName = function askName() {
		return sendCommand(client, COMMAND_SEND_DEVICE_NAME).then(function(buffer) {
			client.name = buffer.toString('ascii');
			console.info('success retreiving name "'+client.name+'"');
			client.trigger('update');
		});
	};
	client.askEvents = function askEvents() {
		return refreshSensorValues();
	};
	client.clearEvents = function clearEvents() {
		var command = COMMAND_CLEAR_EVENT_QUEUE | 2 << 4;
		client.log('clear '+2+' ('+(2 << 4)+') events with command ', command);
		return sendCommand(client, command).then(function(name) {
			// console.info('success clear '+2+' events');
		});
	};
	
	function	refreshSensorValues() {
		return sendCommand(client, COMMAND_SEND_EVENT_QUEUE).then(function(buffer) {
			// console.info('success events of '+buffer.length+' bytes');
			if (!buffer.length) {
				// client.log('No event received');
				return;
			}
			try {
				var events = parseEvents(buffer);
				// client.log('Received '+events.length+' event for a total of '+buffer.length+' bytes (',buffer,')');
				dispatchEvents(events);
				var command = COMMAND_CLEAR_EVENT_QUEUE | events.length << 4;
				return sendCommand(client, command).then(function() {
					// console.info('success clear '+events.length+' events');
					return events;
				});
			}
			catch(e) {
				console.warn(e);
			}
		});
	}
	
	this.destroy = function	destroy() {
		destroyed = true;
		if (tm)
			clearTimeout(tm);
		tm = null;
	};
	
	function	dispatchEvents(events) {
		for (var i=0; i<events.length; i++)
			dispatchEvent(events[i]);
	}
	
	function	dispatchEvent(event) {
		var instance = event.instance;
		var value = event.value;
		// client.log('dispatchEvent ', event);
		
		for (var sensorName in client.sensors)
			if (client.sensors.hasOwnProperty(sensorName)) {
				var sensor = client.sensors[sensorName];
				
				if (instance > 0)
					instance--;
				else {
					var module = findByKey(compiledModules, sensor.module, 'name');
					if (!module)
						client.log('Can\'t import value, sensor invalid for module '+sensor.module);
					else
						applyEvent(sensor, module.convert(value));
					return;
				}
			}
		client.log('module: ', module, ', instance: ', instance, ' not found to apply value ', value);
	}
	
	function	dumpSensors(client) {
		var s = {};
		for (var i in client.sensors)
			if (client.sensors.hasOwnProperty(i))
				s[i] = client.sensors[i].value;
		return s;
	}

	function	applyEvent(sensor, value) {
		// client.log('> apply value ', value, ' to sensor ', sensor.name);
		if (sensor.value !== value) {
			sensor.value = value;
			
			var packet = {sensorsUpdate: {}};
			packet.sensorsUpdate[client.address] = dumpSensors(client);
			client.trigger('sensors', packet);
		}
	}
	
	client.sensors = {};
		// in1: {
			// module: 'Button',
			// name: 'Micro button 13',
			// type: DIGITAL_IN,
			// change: function() {
				
			// },
			// setValue: function() {return Q.reject();},
		// },
		// in2: {
			// module: 'Button',
			// name: 'Micro button A6',
			// type: DIGITAL_IN,
			// change: function() {
				
			// },
			// setValue: function() {return Q.reject();},
		// },
		// in3: {
			// module: 'Button',
			// name: 'Micro button A7',
			// type: DIGITAL_IN,
			// change: function() {
				
			// },
			// setValue: function() {return Q.reject();},
		// },
		// traff1: {
			// module: 'StatusLeds',
			// name: 'Status Leds 11-12-13',
			// type: DIGITAL_OUT,
			// change: function() {
				
			// },
			// setValue: function() {return Q.reject();},
		// },
		// led1: {
			// module: 'Led',
			// name: 'Led 6',
			// type: DIGITAL_OUT,
			// change: function() {
				
			// },
			// setValue: function() {return Q.reject();},
		// },
		// power1: {
			// module: 'PowerMeter',
			// name: 'PowerMeter 1 / 20A',
			// type: ANALOG_IN,
			// change: function() {
				
			// },
			// setValue: function() {return Q.reject();},
		// },
	// };
	
	function	parseSensor(idx, code) {
		var module = findByKey(compiledModules, code, 'code');
		if (!module) {
			console.warn('unsupported module');
			return ;
		}
		var key = 'dev'+idx;
		var sensor = {
			module: module.name,
			idx: idx,
			name: module.name+' '+idx,
			type: module.type,
			change: function() {},
			setValue: function(value) {
				if (!module.serialize) {
					client.log('> not serialize() func on ', module);
					return Q.reject();
				}
				var body = [idx].concat(module.serialize(value));
				return sendCommand(client, COMMAND_SET_MODULE_VALUE, body);
			},
		};
		client.sensors[key] = sensor;
		client.log('> add sensor '+idx+' of type '+module.name);
	}
	
	function	parseSensors(def) {
		for (var i=0; i<def.length; i++)
			parseSensor(i, def[i]);
	}
	
	function	getModulesDefinition() {
		client.log('getModuleDefinition() ...');
		return sendCommand(client, COMMAND_SEND_MODULE_DEF)
			.then(function(def) {
				client.log('received definition ', def);
				parseSensors(def);
				client.trigger('update');
			});
	}
	
	var tm;
	var destroyed = false;
	
	function	loop() {
		tm = null;
		
		refreshSensorValues()
			.then(function() {
				if (destroyed)
					return;
				tm = setTimeout(loop, 100);
			}, function(err) {
				if (destroyed)
					return;
				client.log('> refresh fail, retry in 500 ms');
				tm = setTimeout(loop, 500);
			});
	}
	
	getModulesDefinition()
		.then(function() {
			loop();
		})
	
}


function	resp_checksum(buffer) {
	var chk = 0;

	for (var i=0; i<buffer.length; i++) {
		chk += buffer[i];
		chk %= 256;
		// console.info('chk += '+buffer[i]+': '+chk);
	}
	chk = chk % 42;
	// console.info('chk % 42: '+chk);
	return chk;
}

function	check_hash(buf, hash) {
	var calc = resp_checksum(buf);
//	console.info('compare checksum ', calc, ' should be ', hash);
	return calc === hash;
}

function	sendCommand(client, command, body) {
	var deferred = Q.defer();
	// var property = properties[name];
	var size = 3;
	var error = 0;
	// client.log('ask for ', command, ' of size '+size+' bytes');
	
	function	trySendCommand() {
		if (body) {
			// client.write(COMMAND_VARIABLE_LENGTH, function(err, res) {
				// if (err) {deferred.reject(err); return ;}
			var fullBody = [resp_checksum(body)].concat(body);
			var commandLength = command;
			commandLength |= (body.length + 1) << 4;
			client.log('send command', commandLength, 'with body', fullBody);
			client.writeBytes(commandLength, fullBody, function(err) {
				if (err) {deferred.reject(err); return ;}
				// client.log('> command write complete, wait acknowledge ...');
				
				client.read(size, function(err, res) {
					if (err) {deferred.reject({error: 'Error reading '+size+' bytes'}); return ;}
					
					var ret = res[0];
					var length = res[1];
					var hash = res[2];
					
					// client.log('> response code: '+ret+', length: '+length+' bytes, checksum ', hash);
					
						
					if (ret === COMMAND_RESPONSE_OK) {
						if (!length) {
							// client.log('> packet complete, checksum '+hash+' must equal response length');
							if (hash === 0)
								deferred.resolve(new Buffer([]));
							else
								retryOrReject();
						}
						else {
							readVariableResponse(length, hash);
						}
					}
					else {
						client.log('Unsupported response '+ret+', need to read '+length+' bytes, dont retry for command with body');
						deferred.reject({message: 'Unsupported response '+ret});
					}
				});
			});
		}
		else {
			client.readBytes(command, size, function(err, res) {
				// if (err) {deferred.reject(err); return ;}
				
				// client.log('> write complete, read response payload of '+size+' bytes');
				// client.read(size, function(err, res) {
					if (err) {deferred.reject({error: 'Error reading '+size+' bytes'}); return ;}
					
					var ret = res[0];
					var length = res[1];
					var hash = res[2];
					
					// client.log('> response code: '+ret+', length: '+length+' bytes, checksum ', hash);
					
					if (ret === COMMAND_RESPONSE_OK) {
						if (!length) {
							// client.log('> packet complete, checksum '+hash+' must equal response length');
							if (hash === 0)
								deferred.resolve(new Buffer([]));
							else
								retryOrReject();
						}
						else {
							readVariableResponse(length, hash);
						}
					}
					else if (ret == COMMAND_RESPONSE_MAGIC) {
						if (length === 0) {
							client.log('> magic code found !');
							deferred.resolve(ret);
						}
						else {
							console.warn('response code MAGIC but length =', length);
							deferred.reject();
						}
					}
					else {
						client.log('Unsupported response '+ret+', need to read '+length+' bytes, got '+res.length+'retrying');
						deferred.reject({message: 'Unsupported response '+ret});
					}
				});
			// });
		}
	}
	
	function	readVariableResponse(length, hash) {
		
		// .toString('ascii')
		client.write([COMMAND_CONTINUE_BUFFER], function(err) {
			if (err) {client.log(err); deferred.reject(err); return ;}
			
			
			// client.log('> read remaining '+length+' bytes');
			client.read(length, function(err, res) {
				if (err) {client.log(err); deferred.reject(err); return ;}
				
				// client.log('> response received ('+res.length+' bytes) ', res);
				// console.info(client.address+' > [', res, '] ('+property.convert(res)+')');
				
				if (!check_hash(res, hash)) {
					client.log('> command ', command, ' got packet corrupted ', res, ' for ', length, ' bytes');
					retryOrReject();
					return ;
				}
				try {
					deferred.resolve(new Buffer(res));
				}
				catch(e) {
					client.log(e);
					deferred.reject(e);
				}

			});
		});
	}
	
	function	retryOrReject() {
		error++;
		if (error > 5) {
			client.log('too much corrupted packet');
			deferred.reject({message: 'Corrupted packet for command '+command});
		}
		else {
			client.log('corrupted packet, retrying');
			trySendCommand();
		}
	}
	
	trySendCommand();
	return deferred.promise;
}

module.exports = {
	detect: function detect(client) {
		var deferred = Q.defer();
		
		client.log('try if coconode ', client.address, ' ...');
		sendCommand(client, COMMAND_SEND_MAGIC)
			.then(function(res) {
				client.log('> is it the response ? ', res);
				var module = new coconode(client);
				// client.log('assign methods ', client.askName);
				// applyValues(res, client);
				deferred.resolve(module);
			}, function(err) {
				console.warn('not a coconode: ', err);
				deferred.reject(err);
			}).catch(function(err) {
				console.warn('exception: ', err);
				deferred.reject(err);
			});
		
		return deferred.promise;
	},
};