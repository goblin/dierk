function genbooster(descs, rng) {
	this.set_descs = descs;
	this.rng = rng;
}

function term_matches(term, val) {
	// TODO: original mtgen mentions something about "certain characters need to be converted" if title

	var match = term.match(/^\((.*)\)$/);
	if(match) {
		var options = match[1].split(/\|/);
		return options.includes(val);
	}

	match = term.match(/(true|false)/);
	if(match) {
		if(val === 'true' || val === 'false') {
			return val === term;
		} else {
			return val == (match[1] == 'true' ? 1 : 0);
		}
	}

	return term == val;
}

function execute_query_elem(defs, qe) {
	qe = qe.replace(/'/g, '');

	var match = qe.match(/^(take\[(\d+)\]>)?from\[(.+?)\](\?(.*?)=(.*))?$/);
	if(!match) {
		throw "can't parse query element " + qe;
	}

	var take = match[2];
	var from = match[3];
	var key = match[5];
	var val = match[6];

	if(take) {
		throw "take should be handled elsewhere! " + qe;
	}

	var the_set = defs[from];

	if(key) {
		the_set = the_set.filter(function(e) {
			return (key in e) && term_matches(val, e[key]);
		});
	}

	return the_set;
}

function execute_query(defs, query) {
	var query_elems = query.split(/(\+|-)(?=from|take)/);

	var the_set = execute_query_elem(defs, query_elems.shift());
	for(var i = 0; i < query_elems.length; i += 2) {
		var op = query_elems[i];
		var qe = query_elems[i+1];

		var qe_set = execute_query_elem(defs, qe);

		if(op == '+') {
			the_set.push.apply(the_set, qe_set);
		} else if(op == '-') {
			the_set = the_set.filter(function(e) {
				return !qe_set.includes(e);
			});
		} else {
			throw "unkown operator " + op + " in " + query;
		}
	}

	return the_set;
}

genbooster.prototype.generate_defs = function(setname, packname) {
	var set = this.set_descs[setname];

	if('resolved_defs' in set) {
		// generated earlier
		return;
	}

	var resolved_defs = {'*': this.set_descs[setname].cards};

	set.defs.forEach(function (def) {
		resolved_defs[def.defName] = execute_query(resolved_defs, def.query);
	});

	set['resolved_defs'] = resolved_defs;
};

function cards_from_query(defs, rng, query) {
	var cnt = 1;

	var match = query.match(/^take\[(\d+)\]>/);
	if(match) {
		cnt = match[1];
		query = query.replace(/^take\[\d+\]>/, '');
	}
	
	var query_results = execute_query_elem(defs, query);

	var rv = [];

	for(var i = 0; i < cnt; i++) {
		var idx = rng.getrange(query_results.length);
		// FIXME: mtgen actually uses _.sample, which behaves differently
		// (doesn't return dupes)
		rv.push(query_results[idx]);
	}

	return rv;
}

function get_valid_denominator(firstper, qset) {
	var denominator;

	var match;
	if(typeof(firstper) == 'string') {
		match = firstper.match(/\/(\d+)$/);
	} else {
		match = false;
	}

	if(match) {
		denominator = match[1];

		qset.forEach(function(per) {
			if(!per.percent.match('/' + denominator + '$')) {
				throw "weird percentage " + per;
			}
		});
	} else {
		denominator = '100';

		qset.forEach(function(per) {
			if(typeof(per.percent) == 'string' && per.percent.match('/')) {
				throw "weird percentage " + per;
			}
		});
	}

	return parseInt(denominator);
}

function cards_from_queryset(defs, rng, qset) {
	var firstper = qset[0].percent;
	if(!firstper) {
		throw "unknown queryset";
	}

	var denominator = get_valid_denominator(firstper, qset);
	var accu = 0;
	var lucky = rng.getrange(denominator);

	var rv;
	qset.forEach(function(subq) {
		if(rv) return;
		var per = subq.percent;
		if(typeof(per) == 'string')
			per = per.replace('/' + denominator + '$', '');
		per = parseInt(per);

		if(lucky < per + accu) {
			rv = cards_from_query(defs, rng, "take[1]>" + subq.query);
		}

		accu += per;
	});

	if(!rv) {
		throw "should not be reached";
	}

	return rv;
}

function generate_cards(defs, rng, queries) {
	var rv = [];

	queries.forEach(function(qry) {
		if(qry['query']) {
			rv.push.apply(rv, cards_from_query(defs, rng, qry.query));
		} else if(qry['querySet']) {
			rv.push.apply(rv, cards_from_queryset(defs, rng, qry.querySet));
		} else {
			throw "unknown query " + qry;
		}
	});

	return rv;
}

genbooster.prototype.run = function(setname, packname) {
	this.generate_defs(setname, packname);
	return generate_cards(
		this.set_descs[setname].resolved_defs,
		this.rng,
		this.set_descs[setname].packs[packname].cards
	);
};

module.exports = genbooster;
