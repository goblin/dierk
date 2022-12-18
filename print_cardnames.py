#! /usr/bin/env python3

import json
import sys

allsets = json.load(sys.stdin)

for set_ in allsets['data'].values():
	for card in set_['cards']:
		print(card['setCode'], card['number'], card['name'])
