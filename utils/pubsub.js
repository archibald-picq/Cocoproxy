
function PubSub() {
	var listeners = {};
	function	addListener(name, callback) {
		if (!listeners[name])
			listeners[name] = [];
		listeners[name].push(callback);
	}
	function	removeListener(name, callback) {
		if (!listeners[name])
			return;
		var p;
		if ((p = listeners[name].indexOf(callback)) != -1)
			listeners[name].splice(p, 1);
	}
	function	triggerListeners(name, params) {
		if (listeners[name])
			for (var i=0; i<listeners[name].length; i++)
				listeners[name][i].apply(this, [params]);
	}
	function	clearAllListeners() {
		listeners = {};
	}
	function	clearListeners(name) {
		if (listeners[name])
			delete listeners[name];
	}
	
	this.on = addListener;
	this.unbind = removeListener;
	this.trigger = triggerListeners,
	this.clearAllListeners = clearAllListeners;
	this.clearListeners = clearListeners;
};

module.exports = PubSub;