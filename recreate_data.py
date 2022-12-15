#! /usr/bin/env python3

import sys
import json
import math
import hashlib
import gzip
import os

# feed it AllPrintings.json from mtgjson.net on stdin (tested on version 5.2.0+20221213)
# first argument is the directory in which to put the results

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
def hash_cards(cards, reserved_bits, try_len=4):
	cardnames = list(cards.keys())
	hashed_names = hash_list(cardnames, try_len, reserved_bits)
	sorted_hashed_names = sorted(zip(hashed_names, cardnames))
	if check_if_repeats(map(lambda x: x[0], sorted_hashed_names)):
		return hash_cards(cards, reserved_bits, try_len+1)
	encoded = map(lambda x: encode_hash(x[0], cards[x[1]], reserved_bits), sorted_hashed_names)
	return encoded, try_len

# lut = LookUp Table
# This is a lookup table that allows quickly finding what is the
# latest set that contains a given card.
# the entries are in binary form of a fixed length of x + y;
# first x bits are the blake2b hash of the card's name, last y bits
# encode the set number
def write_card_lut(allsets, output_dir):
	sets_by_release_date = list(allsets.keys())
	sets_by_release_date.sort(reverse=True, key = lambda x: allsets[x]['releaseDate'])

	write_compressed_json(output_dir + 'set_codes.json.gz', sets_by_release_date)

	cards = {}

	def add(name, idx):
		if cards.get(name) is None:
			cards[name] = idx

	for idx, mtgset in enumerate(sets_by_release_date):
		for card in allsets[mtgset]['cards']:
			add(card['name'], idx)
			if card.get('faceName') is not None:
				add(card['faceName'], idx)

	setnum_bits = get_bits_needed(len(sets_by_release_date))
	hashed_cards, elem_size = hash_cards(cards, setnum_bits)

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

def join_words(srcdict, key):
	if srcdict.get(key) is None:
		return ''
	else:
		return ' '.join(srcdict[key])

def extract_important_simple(card):
	rv = pick(card, ['name', 'text', 'manaCost',
		'setCode', 'convertedManaCost',
		'rarity', 'power', 'toughness', 'rulings',
		'layout', 'otherFaceIds', 'side', 'uuid',
		'faceName', 'loyalty'])

	rv['type'] = join_words(card, 'types')
	rv['subtype'] = join_words(card, 'subtypes')
	rv['colors'] = card['colorIdentity']

	if card['identifiers'].get('multiverseId') is not None:
		rv['multiverseId'] = card['identifiers']['multiverseId']
	else:
		#print(f'no mvid for {card["uuid"]}', file=sys.stderr)
		pass
	rv['scryfallId'] = card['identifiers']['scryfallId']

	return rv

def find_other_faces(src_card, set_cards):
	rv = []
	for card in set_cards:
		if card['uuid'] in src_card['otherFaceIds']:
			rv.append(card)

	return rv

def extract_important(card, set_cards):
	rv = extract_important_simple(card)

	if card.get('side') is not None:
		if card['side'] == 'a':
			others = find_other_faces(card, set_cards)
			rv['otherFaces'] = list(map(lambda x: extract_important_simple(x), others))
		else:
			return None

	return rv

def progress(string):
	print(string, file=sys.stderr, flush=True, end='')

def write_sets(allsets, output_dir):
	try:
		os.mkdir(output_dir + 'sets')
	except:
		pass

	count = 1
	for set_code, set_data in allsets.items():
		progress(f'\r[{count}/{len(allsets)}] {set_code}...   ')
		count += 1

		cards = {}
		for card in set_data['cards']:
			imp = extract_important(card, set_data['cards'])

			if imp is not None:
				if cards.get(card['number']):
					raise ValueError(f'set {set_code} has duplicate card number {card["number"]}')
				cards[card['number']] = imp

		write_compressed_json(output_dir + 'sets/' + set_code + '.json.gz', cards)

def recreate_sets(allprintings, output_dir):
	allsets = allprintings['data']
	progress('generating lookup table... ')
	write_card_lut(allsets, output_dir)
	progress('done.\ngenerating sets...\n')
	write_sets(allsets, output_dir)

if __name__ == '__main__':
	output_dir = sys.argv[1] + '/'
	progress('loading stdin... ')
	allprintings = json.load(sys.stdin)
	progress('done.\n')

	recreate_sets(allprintings, output_dir)
	progress('\nall done.\n')
