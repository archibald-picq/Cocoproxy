'use strict';

var Q = require('q');
var COMMAND_RESPONSE_OK = 1;
var COMMAND_RESPONSE_MAGIC = 42;
var COMMAND_CLEAR_BUFFER = 12;
var stats = {
	average: NaN,
	requests: [],
};

var COMMAND_CONTINUE_BUFFER = 1;

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

var commands = [];

function	sendCommand(client, command, body) {
	var deferred = Q.defer();
	
	commands.push({
		client: client,
		command: command,
		body: body,
		deferred: deferred,
	});
	
	if (commands.length === 1)
		executeNextCommand();
	
	return deferred.promise;
}

function	shift_old_stats() {
	var now = new Date();
	var i = 0;
	for (; i < stats.requests.length; i++)
		if ((stats.requests[i].end || stats.requests[i].start) >= now - 5000) {
			break;
		}
	if (i < stats.requests.length)
		stats.requests.splice(0, i);
}

function	getStats() {
	if (!stats.requests.length) {
		return {
			average: NaN,
			count: stats.requests,
		}
	}
	// var lastFinished = stats.requests.length-1;
	// while (lastFinished >= 0 && !stats.requests[lastFinished].end)
		// lastFinished--;
	var count = 0;
	var countSucceed = 0;
	var countFailed = 0;
	// var time = stats.requests[lastFinished].end - stats.requests[0].start;
	var sum = 0;
	var duration = stats.requests[stats.requests.length-1].start - stats.requests[0].start;
	var space = [];
	for (var i = 0; i < stats.requests.length; i++) {
		if (stats.requests[i].end) {
			if (i + 1 < stats.requests.length)
				space.push(stats.requests[i+1].start - stats.requests[i].end);
			sum += stats.requests[i].end - stats.requests[i].start;
			if (stats.requests[i].failed)
				countFailed++;
			else
				countSucceed++;
			count++;
		}
	}
	return {
		duration: duration,
		frequency: stats.requests.length / duration * 1000,
		count: stats.requests.length,
		ping: sum / count,
		succeed: countSucceed,
		failed: countFailed,
		space: space.length? space.reduce(function(a, b) { return a+b; }) / space.length: NaN,
	}
}

function	dumpFromPrevRequest() {
	if (!stats.requests.length)
		return 'never sent';
	var now = new Date();
	var last = stats.requests[stats.requests.length-1];
	if (!last.end)
		return 'not finished, started '+(now-last.start)+' ms ago';
	else
		return 'finished '+(now-last.end)+' ms ago';
}

function	executeNextCommand() {
	if (commands.length === 0) {
		// console.info('this was the last command');
		return;
	}
	if (commands[0].launched) {
		console.warn('!!!! command already in progress !!!!');
	}
	var cmd = commands[0];
	var client = cmd.client;
	var command = cmd.command;
	var body = cmd.body;
	var deferred = cmd.deferred;
	cmd.launched = true;
	
	// var property = properties[name];
	var size = 3;
	var error = 0;
	// client.log('ask for ', command, ' of size '+size+' bytes');
	
	
	function	trySendCommand() {
		// if (client.address == 4)
			// client.log('execute command ('+commands.length+') prev was '+dumpFromPrevRequest()+' ...');
		shift_old_stats();
		
		if (body) {
			
			var fullBody = [resp_checksum(body)].concat(body);
			var commandLength = command;
			commandLength |= (body.length + 1) << 4;
			client.log('send command', commandLength, 'with body', fullBody);
			
			stats.requests.push({start: new Date(), send: fullBody.length+1,});
			
			client.writeBytes(commandLength, fullBody, function(err) {
				stats.requests[stats.requests.length-1].end = new Date();
				
				if (err) {
					stats.requests[stats.requests.length-1].failed = true;
					commands.shift();
					executeNextCommand();
					deferred.reject(err);
					return ;
				}
				// client.log('> command write complete, wait acknowledge ...');
				
				client.read(size, function(err, res) {
					stats.requests[stats.requests.length-1].end = new Date();
					stats.requests[stats.requests.length-1].recv = size;
					
					if (err) {
						stats.requests[stats.requests.length-1].failed = true;
						commands.shift();
						executeNextCommand();
						deferred.reject({error: 'Error reading '+size+' bytes'});
						return ;
					}
					
					var ret = res[0];
					var length = res[1];
					var hash = res[2];
					
					// client.log('> response code: '+ret+', length: '+length+' bytes, checksum ', hash);
					
						
					if (ret === COMMAND_RESPONSE_OK) {
						if (!length) {
							// client.log('> packet complete, checksum '+hash+' must equal response length');
							if (hash === 0) {
								commands.shift(); executeNextCommand();
								deferred.resolve(new Buffer([]));
							}
							else {
								stats.requests[stats.requests.length-1].failed = true;
								retryOrReject();
							}
						}
						else {
							readVariableResponse(length, hash);
						}
					}
					else {
						stats.requests[stats.requests.length-1].failed = true;
						client.log('Unsupported response '+ret+', need to read '+length+' bytes, dont retry for command with body');
						commands.shift();
						executeNextCommand();
						deferred.reject({message: 'Unsupported response '+ret});
					}
				});
			});
		}
		else {
			stats.requests.push({start: new Date(), send: 1,});
			
			if (command === 10)
				client.log('getModuleDefinition() ... ');
			client.readBytes(command, size, function(err, res) {
				
				stats.requests[stats.requests.length-1].end = new Date();
				stats.requests[stats.requests.length-1].recv = size;
					
				// client.log('> 1 byte command complete, read response payload of '+size+' bytes');
				// client.read(size, function(err, res) {
				if (err) {
					stats.requests[stats.requests.length-1].failed = true;
					retryOrReject();
					// commands.shift();
					// executeNextCommand();
					// deferred.reject({error: 'Error reading '+size+' bytes'});
					return ;
				}
				
				var ret = res[0];
				var length = res[1];
				var hash = res[2];
					
				if (client.address == 4 && command == 10) {
					client.log('getModuleDefinition() ... ret: ', ret, ', length: ', length, ', hash: ', hash);
				}
					
				// client.log('> response code: '+ret+', length: '+length+' bytes, checksum ', hash);
				
				if (ret === COMMAND_RESPONSE_OK) {
					if (!length) {
						// client.log('> packet complete, checksum '+hash+' must equal response length');
						if (hash === 0) {
							commands.shift(); executeNextCommand();
							deferred.resolve(new Buffer([]));
						}
						else {
							stats.requests[stats.requests.length-1].failed = true;
							retryOrReject();
						}
					}
					else {
						readVariableResponse(length, hash);
					}
				}
				else if (ret == COMMAND_RESPONSE_MAGIC) {
					if (length === 0) {
						client.log('> magic code found !');
						commands.shift();
						executeNextCommand();
						deferred.resolve(ret);
					}
					else {
						stats.requests[stats.requests.length-1].failed = true;
						console.warn('response code MAGIC but length =', length);
						commands.shift();
						executeNextCommand();
						deferred.reject();
					}
				}
				else {
					stats.requests[stats.requests.length-1].failed = true;
					client.log('Unsupported response '+ret+', need to read '+length+' bytes, got '+res.length+'retrying');
					commands.shift();
					executeNextCommand();
					deferred.reject({message: 'Unsupported response '+ret});
				}
			});
		}
	}
	
	function	readVariableResponse(length, hash) {
		
		stats.requests.push({start: new Date(), send: 1,});
		// .toString('ascii')
		// if (client.address == 4) {
			// client.log('send command continue for '+length+' bytes');
		// }
		// client.write([COMMAND_CONTINUE_BUFFER], function(err) {
			// stats.requests[stats.requests.length-1].end = new Date();

			// if (err) {
				// stats.requests[stats.requests.length-1].failed = true;
				// client.log(err);
				// commands.shift();
				// executeNextCommand();
				// deferred.reject(err);
				// return ;
			// }
			
			
			// client.log('> read remaining '+length+' bytes');
			client.readBytes(COMMAND_CONTINUE_BUFFER, length, function(err, res) {
				stats.requests[stats.requests.length-1].end = new Date();
				stats.requests[stats.requests.length-1].recv = length;
				
				if (err) {
					stats.requests[stats.requests.length-1].failed = true;
					client.log(err);
					commands.shift();
					executeNextCommand();
					deferred.reject(err);
					return ;
				}
				
				// client.log('> response received ('+res.length+' bytes) ', res);
				// console.info(client.address+' > [', res, '] ('+property.convert(res)+')');
				
				if (!check_hash(res, hash)) {
					stats.requests[stats.requests.length-1].failed = true;
					client.log('> command ', command, ' got packet corrupted ', res, ' for ', length, ' bytes');
					retryOrReject();
					return ;
				}
				try {
					commands.shift();
					executeNextCommand();
					deferred.resolve(new Buffer(res));
				}
				catch(e) {
					stats.requests[stats.requests.length-1].failed = true;
					client.log(e);
					commands.shift();
					executeNextCommand();
					deferred.reject(e);
				}

			});
		// });
	}
	
	function	retryOrReject() {
		error++;
		if (error > 5) {
			client.log('too much corrupted packet');
			deferred.reject({message: 'Corrupted packet for command '+command});
			commands.shift(); executeNextCommand();
		}
		else {
			if (client.address == 4 || error > 3) {
				client.log('corrupted packet, retrying ('+error+'/'+5+')');
			}
			client.readBytes(COMMAND_CLEAR_BUFFER, 3, function(err, res) {
				if (err) {
					stats.requests[stats.requests.length-1].failed = true;
					client.log(err);
					commands.shift();
					executeNextCommand();
					deferred.reject(err);
					return ;
				}
				
				var ret = res[0];
				var length = res[1];
				var hash = res[2];
				
				if (client.address == 4 || error > 3) {
					client.log('> response code: '+ret+', length: '+length+' bytes, checksum ', hash);
				}
				setTimeout(trySendCommand, 5);
			});
		}
	}
	
	setTimeout(trySendCommand, 3);
}

module.exports = {
	sendCommand: sendCommand,
	getStats: getStats,
};