'use strict';
// var util = require('util');

var PubSub = require('./utils/pubsub');
var findByKey = require('./utils/find-by-key');
var pub = new PubSub();

var devices = [];

function	addDevice(device) {
	if (findByKey(devices, device.address, 'address') !== null) {
		console.warn('corrupted call, device ', device.address, ' already exists');
		return;
	}
	pub.trigger('device', device);
	devices.push(device);
	
	if (device.type) {
		console.info('device already have type ! ', device.type);
	}
	
	// if (device.address == 0x68) {
		// maybe a MPU-6050 device ?
		
		device.detect();
	// }
	
}

function	getDevice(address) {
	// console.info('get device ', address, ' in ', devices);
	return findByKey(devices, address, 'address');
}

function	removeDevice(device) {
	var  p = findByKey(devices, device.getUniqId(), 'address');
	if (p !== null) {
		console.info('removing device at index ', devices.indexOf(p));
		devices.splice(devices.indexOf(p), 1);
	}
	else
		console.warn('device ', device.getUniqId(), ' not found');
}


function	trigger_change(client, sensor, old_val, new_val) {
	
	//	https://maker.ifttt.com/use/gmnP3qwAztyiVEPhSfq3bAE5ufqYwwsZBrhUXUHVauO
	var post = {};
	post[client.name+'|'+sensor.name] = new_val;
	var post_data = JSON.stringify(post);
	var options = {
		host: 'maker.ifttt.com',
		port: 443,
		path: '/trigger/change/with/key/'+iftttApiKey,
		method: 'POST',
		headers: {
			// 'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': Buffer.byteLength(post_data)
		}
	};

	var request = https
		.request(options, function(res) {
			console.log('STATUS: ' + res.statusCode);
			console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			res.on('data', function (chunk) {
				console.log('BODY: ' + chunk);
			});
		});
		
	request.write(post_data);
	request.end();
}

module.exports = {
	add: addDevice,
	getDevice: getDevice,
	getDevices: function() {return devices;},
	on: pub.on,
	unbind: pub.unbind,
	trigger: pub.trigger,
	clearAllListeners: pub.clearAllListeners,
	clearListeners: pub.clearListeners,
	remove: removeDevice
};