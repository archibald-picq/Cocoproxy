'use sctrict';

var Q = require('q');
var DEVICE_POLLING_INTERVAL = 100;

function	mpu6050(client) {
	
	client.type = 'gyro';
	client.sensors = {
		AcX: {value: 0},
		AcY: {value: 0},
		AcZ: {value: 0},
		Tmp: {value: 0},
		GyX: {value: 0},
		GyY: {value: 0},
		GyZ: {value: 0},
	};
	
	var tm	= null;
	var pollError = 0;
	
	function	poll() {
		tm = null;
		// if (!poll.poller)
			// poll.poller	= {tm:true};
		// client.log('> ask position');
		askPosition(client)
			.then(function(res) {
				pollError = 0;
				if (applyValues(res, client)) {
					var packet = {sensorsUpdate: {}};
					packet.sensorsUpdate[client.address] = dumpSensors(client.sensors);
					client.trigger('sensors', packet);
				}
				
				setTimeout(poll, DEVICE_POLLING_INTERVAL);
			}, function() {
				pollError++;
				if (pollError > 10)
					closeDevice();
				else
					setTimeout(poll, DEVICE_POLLING_INTERVAL);
			}).catch(function(e) {
				client.log('> error ', e);
			});
		
		// ask_property(client, 'state', function(err, res) {
			// if (err) {
				// log_client(client, err);
				// console.info('client lost');
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
	}
	
	function	closeDevice() {
		console.warn('too much error, closing device');
		client.trigger('close');
	}
	
	setTimeout(poll, DEVICE_POLLING_INTERVAL);
	
	this.destroy = function() {
		if (tm != null)
			clearTimeout(tm);
	};
}

function	dumpSensors(sensors) {
	var s = {};
	for (var i in sensors)
		if (sensors.hasOwnProperty(i))
			s[i] = sensors[i].value;
	return s;
}

function	askPosition(client) {
	var deferred = Q.defer();
	client.write([0x3B], function(err, res) {
		if (err) {client.log('fail to write ', err.message); deferred.reject(err); return ; }
		
		// client.log('> write succeed: ', res);
		setTimeout(function() {
			client.read(14, function(err, res) {
				if (err) {client.log('fail to read request 14 bytes ', err.message); deferred.reject(err); return ;}
				
				// client.log('> read succeed: ', res);
				deferred.resolve(res);
			});
		}, 10);
	});
	return deferred.promise;
}

function	applyValues(res, client) {
	var sensors = client.sensors;
	var before = JSON.stringify(dumpSensors(sensors));
	
	sensors.AcX.value = res[0]  << 8 | res[1];  // 0x3B (ACCEL_XOUT_H) & 0x3C (ACCEL_XOUT_L)    
	sensors.AcY.value = res[2]  << 8 | res[3];  // 0x3D (ACCEL_YOUT_H) & 0x3E (ACCEL_YOUT_L)
	sensors.AcZ.value = res[4]  << 8 | res[5];  // 0x3F (ACCEL_ZOUT_H) & 0x40 (ACCEL_ZOUT_L)
	sensors.Tmp.value = res[6]  << 8 | res[7];  // 0x41 (TEMP_OUT_H) & 0x42 (TEMP_OUT_L)
	sensors.GyX.value = res[8]  << 8 | res[9];  // 0x43 (GYRO_XOUT_H) & 0x44 (GYRO_XOUT_L)
	sensors.GyY.value = res[10] << 8 | res[11];  // 0x45 (GYRO_YOUT_H) & 0x46 (GYRO_YOUT_L)
	sensors.GyZ.value = res[12] << 8 | res[13];  // 0x47 (GYRO_ZOUT_H) & 0x48 (GYRO_ZOUT_L)

	// some transformation
	// sensors.Tmp.value = sensors.Tmp.value/340.00+36.53;
	
	var after = JSON.stringify(dumpSensors(sensors));
	// client.log(before != after? '> diff ': '> no diff ', after);
	return before != after;
}


function detect(client) {
	if (client.address !== 0x68 && client.address !== 0x69)
		return Q.reject();
	var deferred = Q.defer();
	
	function	askPos() {
		return askPosition(client);
	}
	
	// client.write([0x6B], function(err, res) {
		// if (err) {deferred.reject();}
		client.write([0x6B, 0x00], function(err, res) {
			if (err) {deferred.reject();}
			askPos()
				.then(askPos)
				.then(askPos)
				.then(askPos)
				.then(askPos)
				.then(askPos)
				.then(askPos)
				.then(askPos)
				.then(askPos)
				.then(askPos)
				.then(function(res) {
					client.log('> sure i\'m here ', res);
					var module = new mpu6050(client);
					applyValues(res, client);
					deferred.resolve(module);
				});
			// client.writeByte(0x3B, function(err, res) {
				// if (err) {client.log('fail to write ', err);}
				
				// client.log('> write succeed: ', res);
				
				// client.readBytes(0, 14, function(err, res) {
					// if (err) {client.log('fail to read request 14 bytes ', err);}
					
					// client.log('> read succeed: ', res);
				// });
			// });
		});
	// });
	
	return deferred.promise;
}

module.exports = {
	detect: detect,
};
