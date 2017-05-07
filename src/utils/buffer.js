
function	makeBuffer() {
	var array = [];
	var args = makeBuffer.arguments;
	for (var i=0; i<args.length; i++) {
		if (typeof args[i] === 'number')
			array.push(args[i]);
		else if (typeof args[i] === 'string') {
			var s = args[i];
			for (var j = 0; j<s.length; j++)
				array.push(s.charCodeAt(j));
		}
		else {
			// convert object if have method for so ?
			array.push(args[i]);
		}
	}
	return new Buffer(array);
}

module.exports = {
	make: makeBuffer,
};