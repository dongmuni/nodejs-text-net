// jshint esversion: 6
/**
 * http://usejsdoc.org/
 */

'use strict';

const util = require('util');
const rnju  = require('@rankwave/nodejs-util');
const decodeText = rnju.encoder.decodeText;

function msg2str(msg)
{
	var str = 'null';
	if ( msg )
	{
		var obj = {code: msg.code, tid: msg.tid, length: (msg.body ? msg.body.length : 0), args: msg.args};
		str = JSON.stringify(obj);
	}
	return str;
}

function createBuffer(capacity) {
	
	var _buffer = Buffer.alloc(capacity);
	var _offset = 0;
	
	function buffer() { 
		return _buffer; 
	}
	
	function length() { 
		return _buffer.length; 
	}
	
	function offset() { 
		return _offset; 
	}
	
	function remain() { 
		return _buffer.length - _offset; 
	}
	
	function write(buf, start, end) {
		
		start = start === undefined ? 0 : start * 1;
		end = end === undefined ? buf.length : end * 1;
		
		var copyLength = Math.min(end - start, remain());
		
		if ( copyLength > 0 )
		{
			buf.copy(_buffer, _offset, start, start + copyLength);
			_offset += copyLength;
		}
		
		return copyLength;
	}

	function toString() {
		return _buffer.toString('utf8', 0, _offset);
	}
	
	function desc() {
		console.log(util.format('length: %d, offset: %d, remain: %s', length(), offset(), remain()));
	}
	
	function reset() {
		_offset = 0;
	}
	
	return {
		buffer: buffer, 
		length: length, 
		offset: offset, 
		remain: remain, 
		write: write, 
		toString: toString, 
		desc: desc, 
		reset: reset
	};
}

function isValidCode(code) 
{
	return code !== null && /^[0-9A-Z]{3,5}$/.test(code);
}

function createParser(callback) 
{
	var headerBuffer = createBuffer(1024);
	var bodyBuffer = null;
	var isHeaderParsing = true;
	var code = null;
	var tid = null;
	var len = 0;
	var args = [];
	
	function feed(buffer) 
	{
		var offset = 0;

		while ( offset < buffer.length )
		{
			if ( isHeaderParsing )
			{
				var lf_offset = buffer.indexOf('\n', offset);

				if ( lf_offset !== -1 )
				{
					var end_offset = lf_offset + 1;
					headerBuffer.write(buffer, offset, end_offset);
					offset = end_offset;
					var header = headerBuffer.toString().trim();
					
					var headerArr = header.split(/\s+/g);
					code = headerArr.length > 0 ? headerArr[0] : null;
					tid = headerArr.length > 1 ? headerArr[1] : null;
					tid = tid !== null && /^\S+$/.test(tid) ? tid : '0';
					len = headerArr.length > 2 ? headerArr[2] : null;
					len = /^[0-9]+$/.test(len) ? len*1 : 0;
					args = decodeText(headerArr.slice(3));

					//console.log(util.format("code=%s, tid=%s, len=%s, args=%s", code, tid, len, args));
					
					if ( isValidCode(code) )
					{
						if ( len > 0 )
						{
							bodyBuffer = createBuffer(len);
							isHeaderParsing = false;
						}
						else
						{
							callback({code: code, tid: tid, args: args, body: null, isValid: true});
							headerBuffer.reset();
						}
					}
					else
					{
						callback({code: code, tid: tid, args: args, body: null, isValid: false});
						headerBuffer.reset();
					}
				}
				else 
				{
					headerBuffer.write(buffer, offset, buffer.length);
					offset = buffer.length;
				}
			}
			else
			{
				var copyLength = Math.min(buffer.length - offset, bodyBuffer.remain());
				bodyBuffer.write(buffer, offset, offset + copyLength);
				offset += copyLength;
				
				if ( bodyBuffer.remain() === 0 )
				{
					callback({code: code, tid: tid, args: args, body: bodyBuffer.buffer(), isValid: true});
					headerBuffer.reset();
					bodyBuffer = null;
					isHeaderParsing = true;
				}
			}
		}
	}
	
	return { feed: feed };
}

module.exports = {
		msg2str: msg2str,
		isValidCode: isValidCode,
		createParser: createParser
};