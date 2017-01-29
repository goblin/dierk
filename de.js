var prng_aes = require('./prng-aes.js');
var genbooster = require('./genbooster.js');
var set_descs = require('./set_descs.json');

var name_idx = {};
var back_idx = {};

// I don't want to convert all the Card objects in the JSON
var Card = {
	'usable': function(card) {
		var usable = true;
		if('usableForDeckBuilding' in card)
			usable = card.usableForDeckBuilding;

		if(('token' in card) && (card.token == true || card.token == 'true'))
			usable = false;

		return usable;
	},
	'get_setnum': function(card, prepend_set) {
		if(card.mtgjson.number === undefined)
			return undefined;

		var num = '00' + card.mtgjson.number.replace(/a$/, '');
		num = num.substr(num.length-3, 3);

		return (prepend_set ? (card.set.toUpperCase() + ':') : '') + num;
	},
	'pt': function(c) {
		if(c.loyalty !== undefined)
			return ' [' + c.loyalty + ']';
		if(c.power === undefined || c.toughness === undefined)
			return '';

		return ' (' + c.power + '/' + c.toughness + ')';
	},
	'from_str': function(str) {
		str = str.replace(/^[ \t]*/, '').replace(/[ \t]*$/, '');
		var match = str.match(/^(\[[A-Za-z0-9:]*\])?[ \t]?(.*)$/);

		if(!match)
			throw "invalid card string: " + str;

		var id = match[1];
		var name = match[2];

		if(id) {
			var submatch = id.match(/\[([A-Za-z]*):([0-9]*)\]/);
			if(!submatch)
				throw "invalid card setnum: " + str;

			var set = submatch[1].toUpperCase();
			var num = '00' + parseInt(submatch[2]).toString();
			num = num.substr(num.length-3, 3);

			var rv = name_idx[set + ':' + num];
			if(!rv)
				throw "card idx not found: " + str;

			if(rv.mtgjson.name != name)
				throw "card's name doesn't match: " + str;

			return rv;
		}

		var rv = name_idx[name.toLowerCase()];
		if(!rv)
			throw "card not found: " + str;

		return rv;
	},
	'get_backside': function(card) {
		return back_idx[card.set + card.mtgjson.name];
	}
};

function set_newer_than(which, thanwhat) {
	var date_which = set_descs[which] ? set_descs[which].date : '19900101';
	var date_thanwhat = set_descs[thanwhat] ? set_descs[thanwhat].date : '19900101';
	return date_which > date_thanwhat;
}

function populate_name_idx() {
	var setnames = Object.keys(set_descs);

	for(var i = 0; i < setnames.length; i++) {
		var cards = set_descs[setnames[i]].cards;
		for(var c = 0; c < cards.length; c++) {
			var card = cards[c];
			if(!Card.usable(card) && !card.doubleFaceBackCard)
				continue;

			if(!card.mtgjson)
				continue;

			// the name_idx should always have the latest
			// set that contains the card
			var lcname = card.mtgjson.name.toLowerCase();
			if(!(lcname in name_idx) || 
					set_newer_than(card.set, name_idx[lcname].set))
				name_idx[lcname] = card;

			if(card.doubleFaceBackCard) {
				if(card.mtgjson.layout == 'meld') {
					back_idx[card.set + card.mtgjson.names[0]] = card;
					back_idx[card.set + card.mtgjson.names[1]] = card;
				} else if(card.mtgjson.layout == 'double-faced') {
					back_idx[card.set + card.mtgjson.names[0]] = card;
				} else
					throw "unknown card layout: " + card.mtgjson.name;
			} else {
				var k = Card.get_setnum(card, true);
				if(k)
					name_idx[k] = card;
			}
		}
	}
}

function SeedCardList(seed, setstr) {
	if(setstr === undefined) {
		var match = seed.match(/^([0-9a-f]*);(.*)$/);
		if(!match)
			throw "invalid SeedCardList initialization string: " + seed;
		this.seed = match[1];
		this.setstr = match[2];
	} else {
		this.seed = seed;
		this.setstr = setstr;
	}
}

SeedCardList.prototype.for_each_booster = function(cb) {
	var rng = new prng_aes(this.seed);
	var gb = new genbooster(set_descs, rng);
	
	var setlist = this.setstr.split(',');
	for(var i in setlist) {
		var match = setlist[i].match(/^(\d+)(...)\.(.*)$/);
		if(!match) {
			match = setlist[i].match(/^(\d+)(...)$/);
			if(!match) {
				throw "error";
			}
		}

		var num = match[1];
		var set = match[2];
		var product = match[3] || set + '-standard';

		for(var i = 0; i < num; i++) {
			cb(gb.run(set, product));
		}
	}
};

SeedCardList.prototype.for_each_usable_card = function(cb, booster_done_cb) {
	this.for_each_booster(function(arr) {
		for(var i in arr) {
			var card = arr[i];

			if(Card.usable(card)) {
				cb(card);
			}
		}
		if(booster_done_cb) {
			booster_done_cb();
		}
	});
};

SeedCardList.prototype.for_each = SeedCardList.prototype.for_each_usable_card;

SeedCardList.prototype.get_name = function() {
	return this.seed.replace(/(........)/g, "$1 ") + '; ' + this.setstr.replace(/,/g, ', ');
};

function ArrayCardList() {
	this.cards = [];
}
ArrayCardList.prototype.for_each = function(cb) {
	for(var i in this.cards) {
		cb(this.cards[i]);
	}
};

function export_(what, full) {
	var res = '';
	var last;
	var cnt = 0;

	function flush() {
		if(last !== undefined && cnt > 0)
			res += cnt + ' ' + last + "\n";
		cnt = 0;
		last = undefined;
	}

	what.for_each(function(c) {
		var setnum = '[' + Card.get_setnum(c, true) + '] ';
		var name = (full ? setnum: '') + c.mtgjson.name;

		if(last != name)
			flush();

		cnt++;
		last = name;
	}, function() {
		flush();
		res += "\n";
	});
	flush();

	return res;
}
SeedCardList.prototype.export_ = 
ArrayCardList.prototype.export_ = function(full) {
	return export_(this, full);
}

ArrayCardList.prototype.import_ = function(strlist) {
	var arr = strlist.split('\n');
	var err = '';
	for(var i = 0; i < arr.length; i++) {
		var line = arr[i];

		if(line.match(/^[ \t]*$/))
			continue;

		var match = line.match(/^[ \t]*(\d+)?[ \t]*(.*)$/);
		if(match) {
			var cnt = match[1] ? parseInt(match[1]) : 1;
			var name = match[2];

			try {
				for(var j = 0; j < cnt; j++) {
					this.cards.push(Card.from_str(name));
				}
			} catch(e) {
				err += "error with line " + line + ": " + e + "\n";
			};
		} else {
			err += "couldn't parse line: " + line  + "\n";
		}

	}

	return err;
}

ArrayCardList.prototype.add_card = function(card) {
	this.cards.push(card);
}

function DeckList(onchange) {
	this.decks = {};
	this.onchange = onchange;
}

DeckList.prototype.changed = function() {
	// TODO: save it
	this.onchange(this);
};

// the deck should be a *CardList, actually
DeckList.prototype.add_deck = function(name, deck) {
	this.decks[name] = deck;
	this.changed();
}

DeckList.prototype.delete_deck = function(name) {
	delete this.decks[name];
	this.changed();
}

function to_export(on_decklist_change) {
	populate_name_idx();
	return {
		"Card": Card,
		"SeedCardList": SeedCardList,
		"ArrayCardList": ArrayCardList,
		"DeckList": DeckList,
		"set_descs": set_descs,
		"name_idx": name_idx,
		"deck_list": new DeckList(on_decklist_change),
	};
}
module.exports = to_export;
if(typeof(window) != 'undefined') {
	window.deck_editor = to_export;
}
