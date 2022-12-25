#! /usr/bin/env python3

import os
import requests
import sys
import shutil
import time

import cards

def download(img):
	url, fname = img
	try:
		resp = requests.get(url, stream=True)
		with open(f'imgs/{fname}', 'wb') as dst:
			for chunk in resp.iter_content(chunk_size=4096):
				dst.write(chunk)
	except Exception as e:
		print(f'when downloading {url} to {fname}: {e}')
		raise e
	time.sleep(.05)

try:
	os.mkdir('imgs')
except:
	pass

for line in sys.stdin:
	rpt, cdata = cards.card_parse(line)
	for img in cards.get_urls_and_fnames(cdata):
		if os.path.isfile(f'imgs/{img[1]}'):
			pass
		else:
			download(img)
