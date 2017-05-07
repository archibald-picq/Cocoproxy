'use strict';

var Q = require('q');
var buffer = require('../../../../utils/buffer');
var i2c = require('../../i2c.command');
console.info('i2c: ', i2c);
var DEVICE_POLLING_INTERVAL = 50;

var DIGITAL_OUT = 0x01;		// for led, light, on/off purpose
var DIGITAL_OUT_TWO_WAY = 0x02;	// for motor with 1 speed in both directions
var DIGITAL_OUT_THREE_WAY = 0x03;	// for traffic light
var DIGITAL_IN = 0x04;		// for switch button, on/off purpose
var ANALOG_IN = 0x05;
var ANALOG_OUT = 0x06;
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
	{
		code: 0x06,
		name: 'Linky module',
		type: ANALOG_OUT,
		convert: function(buffer) {
			var iinst = buffer[0];
			var papp = buffer[2] << 8 | buffer[1];
//			console.info('conver buffer ', buffer, ' ('+buffer[0]+', '+buffer[1]+') to ', iinst, ' A, ', papp, ' VA');
			return {
				iinst: iinst,
				papp: papp,
			};
		}
	},
	{
		code: 0x07,
		name: 'Thermometer',
		type: ANALOG_OUT,
		convert: function(buffer) {
			// console.info('convert buffer of '+buffer.length+' bytes');
			var position = 0;
			var temps = [];
			while (position < buffer.length) {
				temps.push(buffer.readFloatLE(position));//push(buffer[position+1] << 8 | buffer[position]);
				position += 4;
			}
//			console.info('conver buffer ', buffer, ' ('+buffer[0]+', '+buffer[1]+') to ', iinst, ' A, ', papp, ' VA');
			return temps;
		},
	},
	{
		code: 0x08,
		name: 'Switch433',
		type: DIGITAL_OUT,
		convert: function(buffer) {
			// console.info('convert ', buffer);
			return !!buffer[0];
		},
		serialize: function(bool) {
			return [bool? 0x01: 0x00];
		},
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
	// client.log('create instance of coconode for client', client);
	client.type = 'coco';
	client.askName = function askName() {
		return i2c.sendCommand(client, COMMAND_SEND_DEVICE_NAME).then(function(buffer) {
			client.name = buffer.toString('ascii');
			console.info('success retreiving name "'+client.name+'" (', buffer, ')');
			client.trigger('update');
		});
	};
	client.askEvents = function askEvents() {
		return refreshSensorValues();
	};
	client.clearEvents = function clearEvents() {
		var command = COMMAND_CLEAR_EVENT_QUEUE | 2 << 4;
		client.log('clear '+2+' ('+(2 << 4)+') events with command ', command);
		return i2c.sendCommand(client, command).then(function(name) {
			// console.info('success clear '+2+' events');
		});
	};
	
	
	function	refreshSensorValues() {
		return i2c.sendCommand(client, COMMAND_SEND_EVENT_QUEUE).then(function(buffer) {
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
				return i2c.sendCommand(client, command).then(function() {
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
	
	function	parseSensor(idx, code) {
		var module = findByKey(compiledModules, code, 'code');
		if (!module) {
			console.warn('unsupported module \''+code+'\'');
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
				return i2c.sendCommand(client, COMMAND_SET_MODULE_VALUE, body);
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
		// client.log('getModuleDefinition() ...');
		return i2c.sendCommand(client, COMMAND_SEND_MODULE_DEF)
			.then(function(def) {
				try {
					client.log('received definition ', def);
					parseSensors(def);
					client.trigger('update');
				}
				catch(e) {
					console.warn(e);
				}
				console.info('then ...');
			});
	};
	client.getDefinition = getModulesDefinition;
	
	var tm;
	var destroyed = false;
	
	function	loop() {
		tm = null;
		
		try {
			// console.info('refreshSensorValues()');
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
		catch(e) {
			client.log('fail to refresh sensor values');
		}
	}
	
	getModulesDefinition()
		.then(function() {
			client.log('success getting module definition');
			loop();
		}, function(e) {
			client.log('fail to get module definition ', e);
		});
	
}



module.exports = {
	detect: function detect(client) {
		var deferred = Q.defer();
		
		client.log('try if coconode ', client.address, ' ... on ', i2c);
		try {
			i2c.sendCommand(client, COMMAND_SEND_MAGIC)
				.then(function(res) {
					client.log('> coconode device confirmed (',res,')');
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
		}
		catch(e) {
			console.warn('exception: ', e);
		}
		return deferred.promise;
	},
};