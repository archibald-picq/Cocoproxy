var serialport = null;
var Q = require('q');
var buffer = require('../../utils/buffer');
var PubSub = require('../../utils/pubsub');
var findByKey = require('../../utils/find-by-key');
var pub = new PubSub();
Q.longStackSupport = true;

try {
	serialport = require('serialport');
}
catch(e) {
	console.warn('No serial port support');
}

var detectors = {
	sd84: {
		name: 'SD84',
		check: function(port) {
			if (port.manufacturer !== 'FTDI')
				return Q.reject();
			var deferred = Q.defer();
			console.info('here');
			
			console.info('checking if port ', port.comName, ' is sd84');
			setTimeout(function() {
				console.info('checked if port ', port.comName, ' is sd84');
				deferred.reject();
			}, 1000);
			
			return deferred.promise;
		},
	},
	hover: {
		name: 'Poor man\'s robot hover',
		check: require('./module/hover/checker'),
	},
	plotter: {
		name: 'DX-990 Plotter',
		check: function(port) {
			if (port.manufacturer !== 'FTDI')
				return Q.reject();
			
			var deferred = Q.defer();
			
			console.info('checking if port ', port.comName, ' is plotter');
			setTimeout(function() {
				console.info('checked if port ', port.comName, ' is plotter');
				deferred.reject();
			}, 1000);
			
			return deferred.promise;
		},
	},
};

function	autoOpenPort() {
	// var detected = [];
	serialport.list(function (err, ports) {
		var allPortsDetected = [];
		// console.info('ports: ', ports);
		
		
		// var first = null;
		// var detectedPorts = [];
		ports.forEach(function(port) {
			console.info('---------------------');
			console.info('port: ', port);
			
			var result = Q(port);
			
			for (var remoteType in detectors)
				if (detectors.hasOwnProperty(remoteType))
					result = result.then(check_connector(detectors[remoteType], remoteType));
			
			function	check_connector(detector, remoteType) {
				return function() {
					if (port.detected)
						return Q.resolve();
					// console.info('try: ', remoteType, ' on ', port.comName, ' (', detector, ')');
					var deferred = Q.defer();
					detector.check(port)
						.then(function() {
							port.detected = remoteType;
							// console.info('success for ', port.comName, ' => ', remoteType);
							deferred.resolve();
						}, function() {
							// console.info('fail for ', port.comName, ' => ', remoteType);
							deferred.resolve();
						}).catch(function(e) {
							console.info('catch ', e);
						});
					return deferred.promise;
				};
			}
			// deferred.resolve(function() {
				// console.info('resolve');
				// return port.comName;
			// });
			// if (first == null && port.manufacturer === 'FTDI')
				// first = port;
			// ports[port.comName] = port;
			
			var deferred = Q.defer();
			result.then(function() {
				console.info('end of checks for port '+port.comName+' => '+(port.detected? 'detected: '+port.detected: 'nothing detected'));
				deferred.resolve(port);
			}, function(e) {
				console.info('error in checks for port ', port.comName, ' (', e, ')');
				console.info(e.stack);
			});
			allPortsDetected.push(deferred.promise);
		});
		
		// if (!first) {
			// console.warn('No com port');
			// return;
		// }
		// else {
			// console.log(first);
			// openPort(first);
		// }
		// detected = ports;
		Q.all(allPortsDetected)
			.then(function(detected) {
				// console.info(detected);
				// console.info('ici: ', detected);
				console.info('---------------');
				detected.forEach(function(port) {
					console.info(' - '+port.comName+' => '+(port.detected? ' supported by "'+port.detected+'"': ' (not supported)'));
				});
				console.info('---------------');
				detected.forEach(function(port) {
					if (port.detected)
						if (!findByKey(running, port.comName, 'comName')) {
							running.push(initModule(port));
						}
						
				});
				
			}, function() {
				console.info('la: ', la);
			}).catch(function(e) {
				console.info('catch ', e, e.stack);
				
			});
	});
	
}

function	initModule(port) {
	console.info('importing module ', port.detected);
	var constructor = require('./module/'+port.detected+'/'+port.detected);
	console.info(constructor);
	port.running = new constructor(port);
	running.push(port);
	pub.trigger('device', port.running);
}



var running = [];
setTimeout(autoOpenPort, 1);

module.exports = function(config) {
	return {
		on: pub.on,
		unbind: pub.unbind,
		trigger: pub.trigger,
		clearAllListeners: pub.clearAllListeners,
		clearListeners: pub.clearListeners,
	};
};