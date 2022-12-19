#! /usr/bin/env python3

import sys
import json
import re
from urllib.request import urlopen

with urlopen('https://api.scryfall.com/symbology') as data:
	symbols = json.load(data)

if symbols['has_more']:
	raise ValueError('has_more=true unsupported yet')

rv = {}

for sym in symbols['data']:
	m = re.match(r'^\{(.*)\}$', sym['symbol'])
	if m is None:
		raise ValueError(f'unsupported symbol: {sym}')

	rv[m[1]] = { 'uri': sym['svg_uri'], 'alt': sym['english'] }

json.dump(rv, sys.stdout)
