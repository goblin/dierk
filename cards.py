import re
import gzip
import json

sets = {}

def get_set_data(setcode):
	if sets.get(setcode):
		return sets['secode']

	with gzip.open(f'data/sets/{setcode}.json.gz') as ungz:
		data = json.load(ungz)
	
	sets['setcode'] = data
	return sets['setcode']

def get_card(setcode, num):
	setd = get_set_data(setcode)
	num = re.sub(r'^0*', '', num)
	if setd.get(num) is None:
		return setd[f'{num}a'] # hack?
	else:
		return setd[num]

def get_urls_and_fnames(cdata):
	basename = f'{cdata["set"]}_{cdata["collector_number"]}'
	imgs = cdata['print_imgs']
	if len(imgs) > 1:
		rv = list(map(lambda x: [x[1], f'{basename}_{x[0]}.jpg'],
			enumerate(imgs)))
		return rv
	else:
		return [[imgs[0], f'{basename}.jpg']]

def card_parse(line):
	m = re.match(r'^(\d+) \[([A-Za-z0-9]+):([A-Za-z0-9]+)\] ', line)
	if m is None:
		raise ValueError(f'line <{line}> didnt match!')

	rpt, setcode, setnum = m.groups()

	return [int(rpt), get_card(setcode.lower(), setnum)]

