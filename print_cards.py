#! /usr/bin/env python3

import os
import sys

import cards

# first arg should be print_source.svg,
# second arg should be the imgs/ directory,
# third arg should be the out/ directory.
# stdin should be the card list

class Page:
	def __init__(self, src, imgsdir, dstdir):
		self.src = src
		self.imgsdir = imgsdir
		self.dstdir = dstdir
		self.imgs = []
		self.imgcnt = 0
		self.pagecnt = 1

	def add(self, img):
		self.imgs.append(img)
		self.imgcnt += 1
		if self.imgcnt == 9:
			self.output()

	def write(self, data):
		with open(f'{self.dstdir}/page{self.pagecnt:05}.svg', 'wt') as f:
			f.write(data)

	def output(self):
		if self.imgcnt == 0:
			return
		dsts = self.src
		for i in self.imgs:
			dsts = dsts.replace('XXXX', f'../{self.imgsdir}/{i}', 1)
		self.write(dsts)
		self.imgcnt = 0
		self.imgs = []
		self.pagecnt += 1

tmpl = sys.argv[1]
imgsdir = sys.argv[2]
dstdir = sys.argv[3]

with open(sys.argv[1], 'rt') as srcf:
	src = srcf.read()

page = Page(src, imgsdir, dstdir)

for line in sys.stdin:
	rpt, cdata = cards.card_parse(line)
	imgs = cards.get_urls_and_fnames(cdata)
	
	for i in range(rpt):
		for j in imgs:
			page.add(j[1])

page.output()
