#! /usr/bin/env node

async function run(argv) {
	let M = require('./mtgdata.js')
	let m = new M()
	await m.init('http://127.0.0.1:8000/')
	c = await m.lookup_card_by_set_and_num(argv[2], argv[3])
	console.log(c.name)
}

run(process.argv)
