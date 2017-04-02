function	findByKey(array, search, keyName) {
	for (var i=0; i<array.length; i++)
		if (array[i] && array[i][keyName] === search)
			return array[i];
	return null;
}

module.exports = findByKey;