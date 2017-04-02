var Q = require('q');
var serialport = require('serialport');
var buffer = require('../../../../utils/buffer');

function	checker(port) {
	var HELLO_TIMEOUT = 5000;
	
	if (!(port.manufacturer === 'Microsoft' && port.pnpId.indexOf('BTHENUM') === 0))
		return Q.reject();
	
	var deferred = Q.defer();
	
	var timeout = null;
	var myPort = null;
	
	try {
		myPort = new serialport(port.comName, {
			baudRate: 115200,
			dataBits: 8,
			stopBits: 1,
			parity: 'none',
			// look for return and newline at the end of each data packet:
			// parser: serialport.parsers.readline("\n")
		});
	}
	catch(e) {
		console.warn(e);
		return Q.reject(e);
	}
	myPort.on('open', function() {
		console.info(port.comName, 'com port open');
		
		// myPort.write(buffer.make('Hello world from '+port.comName), function() {
			// console.info('hello sent, waiting data');
		// });
		
		var written = myPort.write(buffer.make(0x2a), function() {
			if (!timeout)
				return;
			console.info(port.comName, 'hello sent, waiting data');
		});
		
		updateTimeout();
		
		console.info(port.comName, 'return of write: '+written);
	});
	
	function	updateTimeout() {
		if (timeout)
			clearTimeout(timeout);
		timeout = setTimeout(function() {
			timeout = null;
			console.info(port.comName, 'no response after '+HELLO_TIMEOUT+' ms');
			myPort.removeAllListeners();
			myPort.close();
			deferred.reject();
		}, HELLO_TIMEOUT);
	}
	
	var buf = new Buffer([]);
	myPort.on('data', function(data) {
		// console.info(port.comName, 'buf before: '+buf.length, ' add ', data);
		buf = Buffer.concat([buf, data]);
		// console.info(port.comName, 'buf after: '+buf.length);
		
		console.info(port.comName, 'data: ', data);
		if (!timeout) {
			console.warn(port.comName, 'timeout happen before data receive');
			myPort.removeAllListeners();
			myPort.close();
			deferred.reject();
			return;
		}
		else if (validateBuffer(buf)) {
			
			// var str = data.toString('ascii');
			// console.info(port.comName, 'str ', str);
			clearTimeout(timeout);
			port.con = myPort;
			myPort.removeAllListeners();
			deferred.resolve();
		}
		else {
			updateTimeout();
			console.info(port.comName, 'data: still invalid ('+buf.length+' bytes)');
		}
	});
	myPort.on('close', function() {
		console.info(port.comName, 'com port close');
	});
	myPort.on('error', function(error) {
		console.info(port.comName, 'com port error: ', error);
		myPort.removeAllListeners();
		if (myPort.isOpen())
			myPort.close();
		deferred.reject();
	});
	
	function	validateBuffer(buf) {
		if (buf.length < 2) {
			console.info(port.comName, 'not enought data ('+buf.length+' bytes)');
			return false;
		}
		var code = buf[0];
		var length = buf[1];
		
		if (code !== 1) {
			console.info(port.comName, 'return code not 1');
			return false;
		}
		if (length > 0 && length + 2 <= buf.length) {
			var str = buf.slice(2, length+2).toString('ascii');
			port.remoteName = str;
			console.info(port.comName, 'found name: "'+str+'"');
			return true;
		}
		else
			console.warn('not received enought data (need 2+'+length+' bytes)');
	}
	
	
	
	
	// console.info('checking if port ', port.comName, ' is hover');
	// setTimeout(function() {
		// console.info('checked if port ', port.comName, ' is hover');
		// deferred.resolve();
	// }, 1000);
	
	return deferred.promise;
}

module.exports = checker;