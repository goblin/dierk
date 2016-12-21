function dierk() {
	this.rng = require('random-buffer');
	this.sha = require('js-sha256');
	this.xor = require('buffer-xor');
}

dierk.prototype.sign = function (prv) {
	return this.sha(prv).toString('hex').substr(0, 32);
};

dierk.prototype.gen = function (nick) {
	var oprv = this.rng(16);
	var gprv = this.rng(16);

	var opub = this.sign(oprv);
	var gpub = this.sign(gprv);

	return {
		"ownprv": oprv.toString('hex') + ":ownprv:" + nick,
		"ownpub": opub + ":ownpub:" + nick,
		"genprv": gprv.toString('hex') + ":genprv:" + nick,
		"genpub": gpub + ":genpub:" + nick
	};
};

function arrayize(what) {
	var arr = [];
	if(typeof(what) == 'string') {
		arr.push.apply(arr, what.split("\n"));
	} else {
		what.forEach(function(e) {
			arr.push.apply(arr, e.split("\n"));
		});
	}
	arr = arr.filter(function(e) {
		return e != '';
	});
	return arr;
}

function parse(what) {
	var arr = what.split(":", 3);
	return {
		"data": Buffer.from(arr[0], 'hex'),
		"type": arr[1],
		"nick": arr[2]
	};
}

// takes an array of key strings ["010203:genprv:nick", ...]
// and signs the ones owned by owner (if they're not signed already)

// returns the same kinda hash as .gen()
dierk.prototype.sign_all_mine = function(keys, owner) {
	var rv = {};
	for(var i in keys) {
		var key = parse(keys[i]);
		var parts = key.type.match(/(...)(...)/);
		var pubname = parts[1] + 'pub';
		if(parts[2] == 'prv'
				&& !(pubname in keys)
				&& key.nick === owner) {
			rv[key.type] = keys[i];
			rv[pubname] = this.sign(key.data)
				+ ':' + pubname + ':' + key.nick;
		}
	}

	return rv;
};

function check_pub(obj, typ, pl, keys, state) {
	var shouldbe = Buffer.from(obj.sha(keys[typ+"prv"][pl]), 'hex').
		slice(0, 16);
	if(shouldbe.compare(keys[typ+"pub"][pl]) == 0) {
		state.good.push(typ + "/" + pl);
	} else {
		state.bad.push(typ + "/" + pl);
	}
}

function check_pubs(obj, keys, players, state) {
	players.forEach(function(pl) {
		if(pl in keys["ownprv"]) {
			check_pub(obj, "own", pl, keys, state);
		} else {
			state.unknown.push("own/" + pl);
		}

		if(pl in keys["genprv"]) {
			check_pub(obj, "gen", pl, keys, state);
		} else {
			state.unknown.push("gen/" + pl);
		}
	});
}

function get_allxor_except_me(obj, keys, me) {
	var allgen;

	for(var player in keys["genprv"]) {
		if(player != me) {
			if(allgen == null) {
				allgen = keys["genprv"][player];
			} else {
				allgen = obj.xor(allgen, keys["genprv"][player]);
			}
		}
	};

	return allgen;
}

function get_results(obj, keys, players) {
	var rv = {};
	for(var player in keys["ownprv"]) {
		var pk = keys["ownprv"][player];
		rv[player] = obj.xor(pk,
			get_allxor_except_me(obj, keys, player)).toString('hex');
	};
	return rv;
}

function check_results(obj, keys, players, state) {
	if(state.bad.length > 0) {
		return;
	}

	if(Object.keys(keys['genprv']).length == players.length) {
		state["result"] = get_results(obj, keys, players);
	}
}

dierk.prototype.process = function (strings, players) {
	var string_arr = arrayize(strings);
	var player_arr = arrayize(players);
	var rv = {
		"good": [],
		"bad": [],
		"unknown": [],
		"result": {}, 
	};

	var keys = {
		"ownpub": {},
		"ownprv": {},
		"genpub": {},
		"genprv": {}
	};

	string_arr.forEach(function(e) {
		var d = parse(e);
		keys[d['type']][d['nick']] = d['data'];
	});

	check_pubs(this, keys, player_arr, rv);
	check_results(this, keys, player_arr, rv);

	return rv;
};

module.exports = dierk;
if(typeof(window) != 'undefined') {
	window.dierk = dierk;
}
