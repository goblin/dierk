#! /usr/bin/env python3

import sys
import json
import math
import hashlib
import gzip
import os

# feed it default-cards-*.json from scryfall on stdin
# first argument is rulings-*.json from scryfall
# second argument is the directory in which to put the results (should already be mkdir'ed)

if not sys.version_info >= (3, 9):
	raise RuntimeError('need newish pythons (older might actually work, havent checked)')

def get_bits_needed(count):
	return math.ceil(math.log(count, 2))

def set_last_bits(src_data, dst_data, dst_bitlen):
	rv = bytearray(src_data)
	if dst_bitlen > len(rv) * 8:
		raise ValueError(f'cant set {dst_bitlen} bits from a {len(rv)}-byte value')

	fullbytes = math.floor(dst_bitlen / 8)
	if fullbytes > 0:
		rv[-fullbytes:] = dst_data[1:]

	remainder = dst_bitlen - fullbytes * 8
	pos = len(rv) - fullbytes - 1
	mask = ~((1 << remainder) - 1)
	rv[pos] = rv[pos] & mask | dst_data[0]

	return bytes(rv)

def clear_last_bits(data, num_to_clear):
	return set_last_bits(data, bytes(math.ceil(num_to_clear/8)), num_to_clear)

def blake2b(string, hashlen, cleared_bits):
	data = bytes(string, 'utf-8')
	b = hashlib.blake2b(data, digest_size=hashlen)
	rv = b.digest()
	rv = clear_last_bits(rv, cleared_bits)
	return rv

def hash_list(the_list, hashlen, reserved_bits):
	rv = []
	for el in the_list:
		rv.append(blake2b(el, hashlen, reserved_bits))

	return rv

def check_if_repeats(sorted_list):
	last = None
	for el in sorted_list:
		if last == el:
			return True
		last = el
	return False

def encode_hash(cleared_hash, extra_int, bitlen):
	extra_bytes = extra_int.to_bytes(math.ceil(bitlen / 8), 'big')
	return set_last_bits(cleared_hash, extra_bytes, bitlen)

def write_compressed_json(fname, data):
	with gzip.open(fname, mode='wt', compresslevel=9) as f:
		json.dump(data, f)

# hashes cardnames with the shortest hash size which doesn't produce
# conflicts, while keeping a few bits reserved for encoding the set
def hash_cards(cards, set_ids, reserved_bits, try_len=4):
	cardnames = list(cards.keys())
	hashed_names = hash_list(cardnames, try_len, reserved_bits)
	sorted_hashed_names = sorted(zip(hashed_names, cardnames))
	if check_if_repeats(map(lambda x: x[0], sorted_hashed_names)):
		return hash_cards(cards, set_ids, reserved_bits, try_len+1)
	encoded = map(lambda x:
			encode_hash(x[0], set_ids[cards[x[1]]['scryfall_data']['set']], reserved_bits),
			sorted_hashed_names)
	return encoded, try_len

# lut = LookUp Table
# This is a lookup table that allows quickly finding what is the
# latest set that contains a given card.
# the entries are in binary form of a fixed length of x + y;
# first x bits are the blake2b hash of the card's name, last y bits
# encode the set number
def write_card_lut(card_idx, output_dir):
	sets_sorted = sorted(card_idx['by_set'].keys())

	write_compressed_json(output_dir + 'set_codes.json.gz', sets_sorted)

	set_ids = {}
	for idx, setcode in enumerate(sets_sorted):
		set_ids[setcode] = idx

	setnum_bits = get_bits_needed(len(sets_sorted))
	hashed_cards, elem_size = hash_cards(card_idx['by_name'], set_ids, setnum_bits)

	with gzip.open(output_dir + 'card_lut.bin.gz', mode='wb', compresslevel=9) as f:
		for hc in hashed_cards:
			f.write(hc)

	write_compressed_json(output_dir + 'lut_sizes.json.gz', {
			'bytes_per_entry': elem_size,
			'setidx_bits': setnum_bits
		})

def pick(srcdict, keys):
	rv = {}
	for k in keys:
		if srcdict.get(k) is not None:
			rv[k] = srcdict[k]

	return rv

def parse_types(typeline):
	supertypes = [ 'Basic', 'Legendary', 'Ongoing', 'Snow', 'World', 'Elite', 'Host' ]
	longdash = ' — '

	categories = typeline.split(longdash, 2)

	rv = { 'supertypes': [], 'types': [], 'subtypes': [],
			'supertypes_str': '', 'types_str': '', 'subtypes_str': '' }

	for word in categories[0].split(' '):
		if word in supertypes:
			rv['supertypes'].append(word)
		else:
			rv['types'].append(word)
	
	if len(categories) > 1:
		for word in categories[1].split(' '):
			rv['subtypes'].append(word)

	rv['supertypes_str'] = ' '.join(rv['supertypes'])
	rv['types_str'] = ' '.join(rv['types'])
	rv['subtypes_str'] = ' '.join(rv['subtypes'])

	return rv

def extract_important_simple(card):
	rv = pick(card, ['name', 'oracle_text', 'mana_cost',
		'set', 'cmc', 'rarity', 'power', 'toughness',
		'layout', 'loyalty', 'color_identity',
		'collector_number'])

	if card.get('type_line'):
		types = parse_types(card['type_line'])

		rv['type'] = types['types_str']
		rv['subtype'] = types['subtypes_str']
		rv['supertype'] = types['supertypes_str']

	return rv

def add_image(dst, card):
	uris = card.get('image_uris')
	if uris is None:
		print(f'\nno image for {card["name"]}', file=sys.stderr)
		return

	dst['art_imgs'].append(uris['art_crop'])
	dst['display_imgs'].append(uris['border_crop'])
	dst['print_imgs'].append(uris['large'])

def add_faces(dst, card):
	dst['faces'] = []

	for face in card['card_faces']:
		dst['faces'].append(extract_important_simple(face))

def find_meld_result(card_parts, card_id_idx):
	for part in card_parts:
		if part['component'] == 'meld_result':
			return card_id_idx[part['id']]['scryfall_data']

	raise LookupError(f'meld result not found')

def process_meld(dst, card, card_id_idx):
	result = find_meld_result(card['all_parts'], card_id_idx)
	add_image(dst, card)
	add_image(dst, result)
	dst['faces'] = list(map(lambda x: extract_important_simple(x), [card, result]))

def extract_important(card, card_id_idx):
	cdata = card['scryfall_data']
	rv = extract_important_simple(cdata)
	rv['scryfallId'] = cdata['id']
	rv['rulings'] = card['scryfall_rulings']

	rv['art_imgs'] = []
	rv['display_imgs'] = []
	rv['print_imgs'] = []

	if cdata['layout'] == 'meld':
		process_meld(rv, cdata, card_id_idx)
	elif any(cdata['layout'] == el for el in ['split', 'flip', 'adventure']):
		add_faces(rv, cdata)
		add_image(rv, cdata)
	elif any(cdata['layout'] == el for el in ['transform', 'modal_dfc', 'double_faced_token']):
		add_faces(rv, cdata)
		add_image(rv, cdata['card_faces'][0])
		add_image(rv, cdata['card_faces'][1])
	else:
		add_image(rv, cdata)

	return rv

def progress(string):
	print(string, file=sys.stderr, flush=True, end='')

def write_sets(card_idx, output_dir):
	try:
		os.mkdir(output_dir + 'sets')
	except:
		pass

	count = 1
	for set_code, set_data in card_idx['by_set'].items():
		progress(f'\r[{count}/{len(card_idx["by_set"])}] {set_code}...   ')
		count += 1

		cards = {}
		for card_num, card_data in set_data.items():
			imp = extract_important(card_data, card_idx['by_id'])

			if imp is not None:
				cards[card_num] = imp

		write_compressed_json(output_dir + 'sets/' + set_code + '.json.gz', cards)

def index_rulings(rulings):
	rv = {}

	for ruling in rulings:
		orid = ruling['oracle_id']
		entry = rv.get(orid) or []
		entry.append({'text': ruling['comment']})
		rv[orid] = entry

	return rv

def index_cards(cards, rulings_idx):
	rv = { 'by_set': {}, 'by_name': {}, 'by_id': {} }

	def index_card_by_set(setcode, cardnum, card):
		setdata = rv['by_set'].get(setcode) or {}
		if setdata.get(cardnum):
			raise RuntimeError(f'card {cardnum} is duplicated in set {setcode}')
		setdata[cardnum] = card
		rv['by_set'][setcode] = setdata

	def index_card_by_name(name, card):
		prev = rv['by_name'].get(name)
		if prev and prev['scryfall_data']['released_at'] > card['scryfall_data']['released_at']:
			return
		rv['by_name'][name] = card
		faces = card['scryfall_data'].get('card_faces') or []
		for face in faces:
			rv['by_name'][face['name']] = card

	def index_card_by_id(id_, card):
		if rv['by_id'].get(id_) is not None:
			raise RuntimeError(f'card id {id_} is duplicated')
		rv['by_id'][id_] = card

	for card in cards:
		if card['layout'] == 'reversible_card':
			# reversible cards seem not to have an oracle_id, despite the
			# API docs saying all cards have it. We can skip them, because
			# there always exists a non-reversible version of it (with
			# a more reasonable artwork)
			continue
		if card['layout'] == 'art_series':
			# these cards often don't contain images, and are pretty useless too
			continue
		recard = { 'scryfall_data': card, 'scryfall_rulings': rulings_idx.get(card['oracle_id']) }
		index_card_by_set(card['set'], card['collector_number'], recard)
		index_card_by_name(card['name'], recard)
		index_card_by_id(card['id'], recard)

	return rv

def recreate_sets(cards, rulings, output_dir):
	progress('indexing rulings... ')
	rulings_idx = index_rulings(rulings)
	progress('done.\nindexing cards... ')
	card_idx = index_cards(cards, rulings_idx)
	progress('done.\ngenerating lookup table... ')
	write_card_lut(card_idx, output_dir)
	progress('done.\ngenerating sets...\n')
	write_sets(card_idx, output_dir)

if __name__ == '__main__':
	output_dir = sys.argv[2] + '/'
	progress('loading stdin... ')
	cards = json.load(sys.stdin)
	progress('done.\nloading rulings... ')
	with open(sys.argv[1], 'r') as r:
		rulings = json.load(r)
	progress('done.\n')

	recreate_sets(cards, rulings, output_dir)
	progress('\nall done.\n')
