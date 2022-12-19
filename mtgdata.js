const pako = require('pako')
const blake2 = require('@stablelib/blake2b')
const seedrandom = require('seedrandom')
Math.seedrandom = seedrandom // temporary hack for mtgGen (?)

async function load_gz_file(fname) {
	const fullname = fname + '.gz'
	const bin = await fetch(fullname).then(resp => resp.arrayBuffer())
	return pako.ungzip(new Uint8Array(bin))
}

async function load_gz_json(fname) {
	const data = await load_gz_file(fname + '.json')
	return JSON.parse(new TextDecoder().decode(data))
}

async function load_json(fname) {
	return await fetch(fname).then(resp => resp.json())
}

class MTGSet {
	#data;
	#name_idx;
	#mtgen;
	#mtgdata;
	code;

	constructor(set_data, set_code, all_data) {
		this.#data = set_data
		this.code = set_code
		this.#name_idx = {}
		this.#mtgdata = all_data

		for(const [cnum, cdata] of Object.entries(this.#data)) {
			this.#name_idx[cdata['name']] = cnum

			for(const face of cdata['faces'] || []) {
				const facename = face['name']
				this.#name_idx[facename] = cnum
			}
		}
	}

	// underscore because this function is not meant to be called
	// by anything other than the MTGData class
	async _init_mtgen(wwwroot, mtgen_eval_str) {
		if(typeof(this.#mtgen) != 'undefined') {
			return
		}

		// "DataCloneError" for some reason
		//this.mtgen = structuredClone(mtgen)
		// so let's use this hack instead:
		this.#mtgen = eval(mtgen_eval_str)

		let packroot = wwwroot + this.code.toLowerCase()
		let set_desc
		try {
			set_desc = await load_json(packroot + '/set.json')
		} catch(e) {
			// mtgen pack directory names sometimes have a '_' at the end
			// because codes like 'con' or 'aux' are reserved in Windows
			packroot += '_'
			set_desc = await load_json(packroot + '/set.json')
		}
		packroot += '/'

		let card_files, pack_files
		if(typeof(set_desc['cardFiles']) == 'undefined') {
			card_files = [ 'cardsMain.json', 'cardsToken.json', 'cardsOther.json' ]
		} else {
			card_files = set_desc['cardFiles']
		}
		if(typeof(set_desc['packFiles']) == 'undefined') {
			pack_files = [ 'packs.json' ]
		} else {
			pack_files = set_desc['packFiles']
		}

		const options = {
			'setCode': this.code,
			'setFile': wwwroot + 'sets.json',
			'cardFiles': card_files.map((x) => packroot + x),
			'packFiles': pack_files.map((x) => packroot + x),
			'productFile': packroot + 'products.json',
			'flags': {}
		}
		await this.#mtgen.runWithoutBrowser(options, '', () => {}, () => {})
	}

	get_card_by_num(num) {
		let mynum = '' + num // we sometimes get ints
		mynum = mynum.replace(/^0*/, '') // we sometimes get leading zeroes

		const rv1 = this.#data[mynum]

		if(rv1 !== undefined) {
			return rv1
		} else {
			// sometimes we get missing "a"s (maybe more letters?)
			return this.#data[mynum + 'a']
		}
	}

	get_card_by_name(name) {
		return this.#data[this.#name_idx[name]]
	}

	get_all_cards() {
		return this.#data
	}

	seed_mtgen(seed) {
		this.#mtgen.seedRNG(seed)
	}

	get_mtgen_packs() {
		return {} // TODO
	}

	async *generate_booster(pack) {
		const booster = this.#mtgen.generateCardSetFromPack(pack)
		for(const i of booster) {
			if(i.usableForDeckBuilding) {
				let rv
				const lcset = i['set'].toLowerCase()

				// an EMN booster can produce cards from SOI (ie. a Forest)
				if(lcset == this.code) {
					rv = this.get_card_by_num(i['num'])
				} else {
					rv = await this.#mtgdata.lookup_card_by_set_and_num(lcset, i['num'])
				}

				// KLD has "Revoke Privileges" with "num":"00?"
				if(rv === undefined) {
					rv = await this.#mtgdata.lookup_card_by_set_and_name(lcset, i['title'])
				}
				if(rv === undefined) {
					rv = await this.#mtgdata.lookup_card_by_name(i['title'])
				}

				if(rv === undefined) {
					console.log("couldn't find card", i, booster, pack)
					throw `couldn't find card ${i['title']} ${i['num']}`
				}
				yield rv
			}
		}
	}
}

class LUT {
	// private
	split(val) {
		const bpe = this.bytes_per_entry
		const right_bits = this.setidx_bits
		const left_bits = bpe * 8 - right_bits
		const left_bytes = left_bits >> 3
		const right_bytes = right_bits >> 3

		let hash = new Uint8Array(Math.ceil(left_bits / 8))
		let idx = 0;

		for(let i = 0; i <= left_bytes; i++) {
			hash[i] = val[i]
		}
		const mask = (1 << (right_bits % 8)) - 1
		hash[left_bytes] = val[left_bytes] & ~mask
		idx = val[left_bytes] & mask
		for(let i = left_bytes + 1; i < bpe; i++) {
			idx = (idx << 8) | val[i]
		}

		return [hash, idx]
	}

	constructor(bin, sizes, set_codes) {
		this.bytes_per_entry = sizes.bytes_per_entry
		this.setidx_bits = sizes.setidx_bits
		this.table = {}
		this.set_codes = set_codes

		for(let i = 0; i < bin.length; i += this.bytes_per_entry) {
			const elem = bin.slice(i, i + this.bytes_per_entry)
			const pair = this.split(elem)
			this.table[pair[0]] = pair[1]
		}
	}

	// returns set code or null if not found
	lookup(cardname) {
		let hashed = blake2.hash(new TextEncoder().encode(cardname), this.bytes_per_entry)

		const right_bits = this.setidx_bits
		const right_bytes = right_bits >> 3
		const final_byte = this.bytes_per_entry - right_bytes - 1

		hashed = hashed.subarray(0, final_byte+1)
		const mask = (1 << (this.setidx_bits % 8)) - 1
		hashed.set([hashed[final_byte] & ~mask], final_byte)

		const set_id = this.table[hashed]
		if(typeof(set_id) == 'undefined') {
			return null
		} else {
			return this.set_codes[set_id]
		}
	}
}

class MTGData {
	#card_LUT;
	#loaded_sets;
	#url_prefix;
	#mtgen_eval_str;

	constructor() {
		// Can't have an async constructor. Please await init().
	}

	async init(url_prefix = '') {
		const arr = await Promise.all([
			load_gz_file(url_prefix + 'data/card_lut.bin'),
			load_gz_json(url_prefix + 'data/lut_sizes'),
			load_gz_json(url_prefix + 'data/set_codes')])
		this.#card_LUT = new LUT(...arr)
		this.#loaded_sets = {}
		this.#url_prefix = url_prefix
	}

	// private
	async load_set(set_code) {
		const set_data = await load_gz_json(this.#url_prefix + 'data/sets/' + set_code)
		const set = new MTGSet(set_data, set_code, this)
		this.#loaded_sets[set_code] = set
		return set
	}

	async init_mtgen(set) {
		// haacky as fuucky
		if(typeof(this.#mtgen_eval_str) == 'undefined') {
			this.#mtgen_eval_str = await fetch(this.#url_prefix + 'data/mtgen/lib/mtg-generator-lib.js').then(resp => resp.text())
			this.#mtgen_eval_str += '\nmtgGen'
		}
		if(typeof(set.mtgen) == 'undefined') {
			await set._init_mtgen(this.#url_prefix + 'data/mtgen/', this.#mtgen_eval_str)
		}
	}

	async get_set_by_code(set_code) {
		if(typeof(this.#loaded_sets[set_code]) == 'undefined') {
			return this.load_set(set_code)
		}
		return this.#loaded_sets[set_code]
	}

	async lookup_card_by_name(name) {
		const set_code = this.#card_LUT.lookup(name)
		if(set_code == null) {
			return null
		}

		const set = await this.get_set_by_code(set_code)

		return set.get_card_by_name(name)
	}

	async lookup_card_by_set_and_name(set_code, name) {
		const set = await this.get_set_by_code(set_code)

		return set.get_card_by_name(name)
	}

	async lookup_card_by_set_and_num(set_code, num) {
		const set = await this.get_set_by_code(set_code)

		return set.get_card_by_num(num)
	}
}

if(typeof(module) == 'object') {
	module.exports = MTGData;
	console.log(MTGData); // TODO: remove this
}
