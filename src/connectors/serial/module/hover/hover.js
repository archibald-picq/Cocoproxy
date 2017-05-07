'use strict';
var buffer = require('../../../../utils/buffer');
var PubSub = require('../../../../utils/pubsub');
var findByKey = require('../../../../utils/find-by-key');
var Q = require('q');
var COMMAND_VARIABLE_LENGTH = 0x14;
var COMMAND_SET_BITMASK_VALUE = 0x2e;
var COMMAND_ECHO = 0x2e;

function	HoverModule(port) {
	var pub = new PubSub();
	this.address = port.comName;
	console.info('===========================================================');
	console.info('===========================================================');
	console.info('===========================================================');
	console.info('===========================================================');
	console.info('creating module Hover for comPort ', port.comName);
	
	var buf = new Buffer([]);
	port.con.on('data', function(data) {
		buf = Buffer.concat([buf, data]);
		var str = '';
		try {
			str = data.toString('ascii');
		}
		catch(e) {}
		// console.info(port.comName, 'com port data ', data, ' (', str, ')');
		var command;
		if ((command = validateBuffer(buf))) {
			if (command.code == 1) {
				console.info('return of command: ', command.buffer);
			}
			else if (command.code == 84) {
				// console.info('event from remote: ', command.buffer);
				parse_event(command.buffer);
			}
			else {
				console.info('unsupported command ', command.code, ' with buffer ', command.buffer);
			}
		}
		else {
			console.info(port.comName, 'data: still invalid ('+buf.length+' bytes)');
		}
	});
	port.con.on('close', function() {
		console.info(port.comName, 'com port close');
		pub.trigger('close');
	});
	port.con.on('error', function(error) {
		console.info(port.comName, 'com port error ', error);
		
	});
	
	function	parse_event(buffer) {
		console.info('parse buffer from remote: ', buffer);
		var pin = buffer[0] + buffer[1] << 8;
		var value = buffer[2];
		
		console.info('pin change: ', pin, ' value: ',  value? 'HIGH': 'LOW');
	}
	
	function	validateBuffer(rest) {
		if (rest.length < 2) {
			console.info(port.comName, 'not enought data ('+rest.length+' bytes)');
			return false;
		}
		var code = rest[0];
		var length = rest[1];
		
		if (length > 0 && length + 2 <= rest.length) {
			var str = rest.slice(2, length+2);
			buf = rest.slice(length+2);
			
			console.info(port.comName, 'found buffer with code '+code+' of length '+length+': "'+str.toString('ascii')+'"');
			return {code: code, buffer: str};
		}
		else
			console.warn(port.comName, 'not received enought data (need 2+'+length+' bytes)');
	}
	
	var operations = [
		// function	motor_left() {
			// return 0x02;
		// },
		
		// function	motor_right() {
			// return 0x08;
		// },
		
		function	all_off() {
			return 0;
		}
	];
	
	var currentOperationIndex = 0;
	
	(function	rotate() {
		return;
		var bitmask = operations[currentOperationIndex++]();
		currentOperationIndex = currentOperationIndex % operations.length;
		// bitmask += 0x02;
		var bytes = buffer.make(COMMAND_SET_BITMASK_VALUE, bitmask);
		console.info('start motor left ', bytes);
		port.con.write(bytes, function() {
			setTimeout(rotate, 2000);
			// setTimeout(function() {
				// var bitmask = 0;
				// // bitmask += MOTOR_LEFT_FORWARD;
				// bitmask += 0x08;
				// // var bytes = buffer.make(COMMAND_VARIABLE_LENGTH, COMMAND_SET_BITMASK_VALUE, 5, bitmask, 42, 42, 42, 42);
				// console.info('start motor right ', bytes);
				// port.con.write(buffer.make(bytes, 0), function() {
					// setTimeout(function() {
						// port.con.write(buffer.make(0x2a), function() {
							// setTimeout(function() {
								// var echo = 'Hello World';
								// // var bytes = buffer.make(COMMAND_VARIABLE_LENGTH, COMMAND_ECHO, echo.length, echo);
								// console.info('send echo ', bytes);
								// port.con.write(buffer.make(bytes, 0), function() {
									// setTimeout(function() {
										// var bitmask = 0;
										// // var bytes = buffer.make(COMMAND_VARIABLE_LENGTH, COMMAND_SET_BITMASK_VALUE, 5, bitmask, 42, 42, 42, 42);
										// console.info('stop motors ', bytes);
										// port.con.write(buffer.make(bytes, 0), function() {
											// console.info('end of test');
											// console.info('');
											// setTimeout(rotate, 2000);
										// });
									// }, 2000);
								// });
							// }, 2000);
						// });
					// }, 2000);
				// });
				
			// }, 2000);
		});
	})();
	
	var DIGITAL_OUT = 0x01;		// for led, light, on/off purpose
	var DIGITAL_OUT_TWO_WAY = 0x02;	// for motor with 1 speed in both directions
	var DIGITAL_IN = 0x03;		// for led, light, on/off purpose
	
	function	setter(code) {
		return function(value) {
			console.info('set value ', value, ' for ', code);
			var deferred = Q.defer();
			
			deferred.resolve();
			
			return deferred.promise;
		};
	}
	
	var currentBitmask = 0;
	var sensors = [{
		code: 'm1',
		name: 'MotorLeft',
		value: 0,
		type: DIGITAL_OUT_TWO_WAY,
		setValue: function(value) {
			var deferred = Q.defer();
			currentBitmask &= ~0x01 & ~0x02;
			if (value > 0)
				currentBitmask |= 0x01;
			else if (value < 0)
				currentBitmask |= 0x02;
			var bytes = buffer.make(COMMAND_SET_BITMASK_VALUE, currentBitmask);
			console.info('start motor left ', bytes);
			port.con.write(bytes, function() {
				deferred.resolve({hint: 'bitmask set to '+currentBitmask});
			});
			return deferred.promise;
		},
	}, {
		code: 'm2',
		name: 'MotorRight',
		value: 0,
		type: DIGITAL_OUT_TWO_WAY,
		setValue: function(value) {
			var deferred = Q.defer();
			currentBitmask &= ~0x04 & ~0x08;
			if (value > 0)
				currentBitmask |= 0x04;
			else if (value < 0)
				currentBitmask |= 0x08;
			var bytes = buffer.make(COMMAND_SET_BITMASK_VALUE, currentBitmask);
			console.info('start motor left ', bytes);
			port.con.write(bytes, function() {
				deferred.resolve();
			});
			return deferred.promise;
		},
	}, {
		code: 'd1',
		name: 'Led A',
		value: 0,
		type: DIGITAL_OUT,
		setValue: setter('d1'),
	}, {
		code: 'd2',
		name: 'Led B',
		value: 0,
		type: DIGITAL_OUT,
		setValue: setter('d2'),
	}, {
		code: 'd3',
		name: 'Led C',
		value: 0,
		type: DIGITAL_OUT,
		setValue: setter('d3'),
	}, {
		code: 'd4',
		name: 'Button A',
		value: 0,
		type: DIGITAL_IN,
		// setValue: setter('d4'),
	}, {
		code: 'd5',
		name: 'Button B',
		value: 0,
		type: DIGITAL_IN,
		// setValue: setter('d5'),
	}, {
		code: 'd6',
		name: 'Button C',
		value: 0,
		type: DIGITAL_IN,
		// setValue: setter('d6'),
	}, {
		code: 'd7',
		name: 'Bumper A',
		value: 0,
		type: DIGITAL_IN,
		// setValue: setter('d7'),
	}, {
		code: 'd8',
		name: 'Bumper B',
		value: 0,
		type: DIGITAL_IN,
		// setValue: setter('d8'),
	}];
	
	this.getSensor = function(code) {
		return findByKey(sensors, code, 'code');
	};
	
	this.on = pub.on;
	this.unbind = pub.unbind;
	this.trigger = pub.trigger;
	this.clearAllListeners = pub.clearAllListeners;
	this.clearListeners = pub.clearListeners;
	this.dump = function() {
		return {
			address: port.comName,
			name: port.remoteName || port.comName,
			build: port.build,
			boottime: port.boottime,
			sensors: (function(sensors) {
				var s = [];
				for (var i in sensors)
					if (sensors.hasOwnProperty(i))
						s.push({code: sensors[i].code, name: sensors[i].name, value: sensors[i].value, type: sensors[i].type});
				return s;
			})(sensors),
		};
	};
	
	console.info('robot '+port.remoteName+' ready');
}

module.exports = HoverModule;
