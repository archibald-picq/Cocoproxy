function	reldate(t) {
	var val = Math.round(t/1000);
	
	var nn = val<0;
	var s = [];
	val = Math.abs(val);
	if (val % 60)
		s.splice(0, 0, (val % 60)+' second'+(val % 60>1? 's':''));
	if ((val = Math.floor(val / 60))) {
		if (val%60)
			s.splice(0, 0, (val % 60)+' minute'+(val % 60>1? 's':''));
		if ((val = Math.floor(val / 60))) {
			if (val % 24)
				s.splice(0, 0, (val % 24)+' hour'+(val % 24>1? 's':''));
			if ((val = Math.floor(val / 24))) {
				if (val > 365) {
					s.splice(0, 0, Math.floor(val % 365)+' day'+(val % 365>1? 's':''));
					s.splice(0, 0, Math.floor(val / 365)+' year'+(Math.floor(val / 365)>1? 's':''));
				}
				else
					s.splice(0, 0, val+' day'+(val>1? 's':''));
			}
		}
	}
	s = s.slice(0, 2);
	return (nn? 'In ': '')+(s.length? s.join(' and '): ' less than a minute');
}

module.exports = reldate;