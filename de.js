const MTGData = require('./mtgdata.js')
const mtgdata = new MTGData()
const symbology = require('./symbology.json')

// I don't want to convert all the Card objects in the JSON
class Card {
	static fmt_setnum(card, prepend_set) {
		if(card.collector_number === undefined)
			return undefined;

		// TODO: dubious
		let num = '00' + card.collector_number.replace(/a$/, '');
		num = num.substr(num.length-3, 3);

		return (prepend_set ? (card.set.toUpperCase() + ':') : '') + num;
	}

	static fmt_pt(c) {
		if(c.loyalty !== undefined)
			return ' [' + c.loyalty + ']';
		if(c.power === undefined || c.toughness === undefined)
			return '';

		return ' (' + c.power + '/' + c.toughness + ')';
	}

	static async from_str(str) {
		str = str.replace(/^[ \t]*/, '').replace(/[ \t]*$/, '');
		let match = str.match(/^(\[[A-Za-z0-9:]*\])?[ \t]?(.*)$/);

		if(!match)
			throw "invalid card string: " + str;

		let id = match[1];
		let name = match[2];

		if(id) {
			let submatch = id.match(/\[([A-Za-z]*):([0-9]*)\]/);
			if(!submatch)
				throw "invalid card setnum: " + str;

			let set = submatch[1].toLowerCase();

			// TODO: check if it works; for now I think mtgdata doesn't contain leading zeroes
			//let num = '00' + parseInt(submatch[2]).toString();
			//num = num.substr(num.length-3, 3);
			let num = submatch[2]

			const rv = await mtgdata.lookup_card_by_set_and_num(set, num)
			if(!rv) {
				throw 'card not found'
			}
			return rv
		}

		const rv = await mtgdata.lookup_card_by_name(name)
		if(!rv) {
			throw 'card not found'
		}
		return rv
	}
}

class CardList {
	async export_(full, showseed) {
		var res = '';
		var last;
		var cnt = 0;

		function flush() {
			if(last !== undefined && cnt > 0)
				res += cnt + ' ' + last + "\n";
			cnt = 0;
			last = undefined;
		}

		await this.for_each(function(c) {
			var setnum = '[' + Card.fmt_setnum(c, true) + '] ';
			var name = (full ? setnum: '') + c.name;

			if(last != name)
				flush();

			cnt++;
			last = name;
		}, function(seed) {
			flush();
			res += "\n";
		}, function(seed) {
			if(showseed) {
				res += `# ${seed}\n`
			}
		});
		flush();

		return res;
	}

	async stats() {
		var tot = 0;
		var lands = 0;
		var creats = 0;
		var arts = 0;
		var other = 0;

		await this.for_each(function(c) {
			tot++;
			if(c.type.match(/Creature/))
				creats++;
			else if(c.type.match(/Land/))
				lands++;
			else if(c.type.match(/Artifact/))
				arts++;
			else
				other++;
		});

		return tot + ": " + lands + " lands, " + creats + " creatures, " +
			arts + " artifacts, " + other + " other.";
	}

	async for_each() {
		throw "virtual method"
	}
}

class SeedCardList extends CardList {
	#seed;
	#setstr;

	constructor(seed, setstr) {
		super()
		if(setstr === undefined) {
			const match = seed.match(/^([0-9a-f]*);(.*)$/);
			if(!match)
				throw "invalid SeedCardList initialization string: " + seed;
			this.#seed = match[1];
			this.#setstr = match[2];
		} else {
			this.#seed = seed;
			this.#setstr = setstr;
		}
	}

	// private
	async *for_each_booster() {
		const setlist = this.#setstr.split(',');
		for(const i in setlist) {
			let match = setlist[i].match(/^(\d+)(...)\.(.*)$/);
			if(!match) {
				match = setlist[i].match(/^(\d+)(...)$/);
				if(!match) {
					throw "error";
				}
			}

			const num = match[1];
			const set = match[2];
			const product = match[3] || set + '-standard';

			for(let j = 0; j < num; j++) {
				const curseed = this.#seed + '_' + set + '.' + product + '_' + j

				const mtgset = await mtgdata.get_set_by_code(set)
				await mtgdata.init_mtgen(mtgset)

				mtgset.seed_mtgen(curseed)
				yield [curseed, mtgset.generate_booster(product)]
			}
		}
	}

	async for_each(cb, booster_done_cb, seed_cb) {
		for await (const pair of this.for_each_booster()) {
			const seed = pair[0]
			const boost = pair[1]
			if(seed_cb) {
				seed_cb(seed)
			}
			for await (const card of boost) {
				cb(card)
			}
			if(booster_done_cb) {
				booster_done_cb(seed)
			}
		}
	}

	get_name() {
		return 'seed ' + this.#seed.replace(/(........)/g, "$1 ") + '; ' + this.#setstr.replace(/,/g, ', ');
	}

	async store() {
		return { 
			type: 'seed', 
			seed: this.#seed, 
			setstr: this.#setstr
		}
	}
}

class ArrayCardList extends CardList {
	#cards

	constructor() {
		super()
		this.#cards = [];
	}

	async for_each(cb) {
		for(var i in this.#cards) {
			cb(this.#cards[i]);
		}
	}

	async import_(strlist) {
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
						const card = await Card.from_str(name)
						this.#cards.push(card);
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

	add_card(card) {
		this.#cards.push(card);
	}

	async store() {
		return {
			type: 'list',
			cards: await this.export_(true, false)
		}
	}
}

class MyStorage {
	static set(name, data) {
		if(window && window.localStorage) {
			window.localStorage.setItem(name, JSON.stringify(data))
		}
	}
	static get(name) {
		if(window && window.localStorage) {
			return JSON.parse(window.localStorage.getItem(name))
		}
		return null
	}
	static remove(name) {
		if(window && window.localStorage) {
			window.localStorage.removeItem(name)
		}
	}
	static *all() {
		if(window && window.localStorage) {
			for(let i = 0; i < window.localStorage.length; i++) {
				const k = window.localStorage.key(i)
				const v = window.localStorage.getItem(k)
				yield [k, v]
			}
		}
	}
}

class DeckList {
	decks;
	#onchange;

	constructor(onchange) {
		this.decks = {};
		this.#onchange = onchange;
	}

	// private
	async changed() {
		// TODO: save it
		await this.#onchange(this);
	}

	async load() {
		for(let i of MyStorage.all()) {
			let [name, data] = i
			data = JSON.parse(data)
			let deck
			if(data['type'] == 'seed') {
				deck = new SeedCardList(data['seed'], data['setstr'])
			} else if(data['type'] == 'list') {
				deck = new ArrayCardList()
				deck.import_(data['cards'])
			}
			if(deck) {
				this.decks[name] = deck
			}
		}
	}

	// the deck should be a *CardList, actually
	async add_deck(name, deck) {
		this.decks[name] = deck;
		await this.changed();
		MyStorage.set(name, await deck.store())
	}

	async delete_deck(name) {
		delete this.decks[name];
		await this.changed();
		MyStorage.remove(name);
	}
}

async function init() {
	await mtgdata.init()
}

function to_export(on_decklist_change) {
	return {
		"Card": Card,
		"SeedCardList": SeedCardList,
		"ArrayCardList": ArrayCardList,
		"deck_list": new DeckList(on_decklist_change),
		"symbology": symbology,
		"init": init
	};
}
module.exports = to_export;
if(typeof(window) != 'undefined') {
	window.deck_editor = to_export;
}
