function prng_aes(key) {
	this.hb = new (require('./hexbytes.js'))();
	this.aes = new (require('aes-js')).AES(this.hb.hex2bytes(key));

	this.ctr = [0, 0, 0, 0];
	this.data = [];
}

// returns a random 32-bit integer
prng_aes.prototype.get = function() {
	if(this.data.length == 0) {
		var plaintext = this.hb.hex2bytes(this.hb.quads2hex(this.ctr));

		var aes_bytes = this.aes.encrypt(plaintext);
		this.data.push.apply(this.data, 
			this.hb.hex2quads(this.hb.bytes2hex(aes_bytes))
		);

		this.ctr[3]++;
	}

	//console.log('AES/get returns: ', this.data[0].toString(16));

	return this.data.shift();
}

// returns a random int from [0 - to)
prng_aes.prototype.getrange = function(to) {
	if(to < 1 || to > Math.pow(2, 31) - 1) {
		throw "bad range";
	}

	var max = Math.floor(Math.pow(2, 32) / to) * to;
	var num;
	do {
		num = this.get();
	} while(num >= max);

	//console.log('getrange(' + to + ') returns: ' + num % to);
	return num % to;
}

module.exports = prng_aes;
