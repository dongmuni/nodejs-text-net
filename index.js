// jshint esversion: 6

/**
 * http://usejsdoc.org/
 */

[
	'text-parser', 
	'text-net', 
	'text-session'
].forEach((path) => Object.assign(module.exports, require(`./${path}`)));
