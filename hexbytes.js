function hexbytes() {
}

hexbytes.prototype.hex2bytes = function (str) {
	var a = [];
	for(var i = 0; i < str.length; i += 2) {
		a.push(parseInt("0x" + str.substr(i, 2), 16))
	}
	return a;
};

hexbytes.prototype.hex2quads = function (str) {
	var a = [];
	for(var i = 0; i < str.length; i+= 8) {
		a.push(parseInt("0x" + str.substr(i, 8), 16));
	}
	return a;
}

hexbytes.prototype.bytes2hex = function (arr) {
    var o = '';

    for(var i = 0; i < arr.length; i++) {
		var num = '00' + arr[i].toString(16);
        o += num.substr(num.length-2);
    }   
    
    return o;
}

hexbytes.prototype.quads2hex = function (arr) {
	var o = '';

	for(var i = 0; i < arr.length; i++) {
		var num = '00000000' + arr[i].toString(16);
        o += num.substr(num.length-8);
	}

	return o;
}

module.exports = hexbytes;
