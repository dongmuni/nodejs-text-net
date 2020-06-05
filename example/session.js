// jshint esversion: 6

'use strict';

const textNet = require('@rankwave/nodejs-text-net');
const rnju = require('@rankwave/nodejs-util');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ByteCounter = rnju.stream.ByteCounter;

function opt(options) {
	return Object.assign({ debugHeader: false, logConnection: false, logError: false, logSession: true, debugSession: false }, options);
}

function startServer() {
	// listen for client
	let server = textNet.createServer(opt({}));
	server.listen(opt({ port: 1234 }), () => {
		console.log('listening for clients');
	});

	// recv file
	server.on('client', (client) => {
		client.onSession('FILE', (session) => {
			let recvCounter = new ByteCounter(() => console.log(`recv ${recvCounter.bytesPiped} bytes`));
			let filename = session.session_args[0];
			let fws = fs.createWriteStream('recv/' + filename, { flags: 'w' });
			session.on('end', () => session.end());
			session.pipe(recvCounter).pipe(fws);
		});

		client.on('error', (e) => {
		});
	});
}

function startClient() {
	let filepath = process.argv[3];

	if (!filepath) {
		console.error(`USAGE: node ${process.argv[1]} ${process.argv[2]} {filename}`);
		return;
	}

	if (!fs.existsSync(filepath)) {
		console.error(`File not found: ${filepath}`);
		return;
	}

	let filename = path.basename(filepath);

	// send file
	let client = textNet.connect(opt({ host: 'localhost', port: 1234 }), () => {
		let sendCounter1 = new ByteCounter(() => console.log(`original send ${sendCounter1.bytesPiped} bytes`));
		let sendCounter2 = new ByteCounter(() => console.log(`compress send ${sendCounter2.bytesPiped} bytes`));
		let frs = fs.createReadStream(filepath, { flags: 'r' });
		let gzip = zlib.createGzip();
		let session = client.createSession('FILE', [`${filename}.gz`]);
		session.on('close', () => client.closeStream());
		frs.pipe(sendCounter1).pipe(gzip).pipe(sendCounter2).pipe(session);
	});
}

let appType = process.argv[2];

if (appType === 'server') {
	startServer();
}
else if (appType === 'client') {
	startClient();
}
else {
	console.log(`${process.argv[0]} ${process.argv[1]} (client|server)`);
}