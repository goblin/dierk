#! /usr/bin/env python3

import json
import sys
import gzip

setcode = sys.argv[1]

with gzip.open(f'data/sets/{setcode}.json.gz') as ungz:
	data = json.load(ungz)

for num, card in data.items():
	if card['name'] in [ 'Forest', 'Swamp', 'Island', 'Plains', 'Mountain' ]:
		print(f'1 [{setcode}:{num}] {card["name"]}')
