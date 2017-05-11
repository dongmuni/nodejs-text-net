// jshint esversion: 6

'use strict';

const textNet = require('@rankwave/nodejs-text-net');
const rnju    = require('@rankwave/nodejs-util');
const crypto  = require('crypto');
const fs      = require('fs');

const ByteCounter = rnju.stream.ByteCounter;

function opt(options)
{
	return Object.assign({debugHeader: false, logConnection: false, logError: false, logSession: true, debugSession: false}, options);
}

function startServer()
{
	// listen for client
	var server = textNet.createServer(opt({}));
	server.listen(opt({port: 1234}), () => {
		console.log('listening for clients');
	});
	
	// recv file
	server.on('client', (client) => {
		client.onSession('FILE', (session) => {
			var recvCounter = new ByteCounter(() => console.log(`recv ${recvCounter.bytesPiped} bytes`));
			var filename = session.session_args[0];
			var fws = fs.createWriteStream('recv/' + filename, {flags:'w'});
			session.on('end', () => session.end());
			session.pipe(recvCounter).pipe(fws);
		});
		
		client.on('error', (e) => {
		});
	});
}

function startClient()
{
	var reqCnt = 0;
	var isEnd = false;
	
	// send file
	var client = textNet.connect(opt({host: 'localhost', port: 1234}), () => {
		var sendCounter = new ByteCounter(() => console.log(`send ${sendCounter.bytesPiped} bytes`));
		var filename = 'image.jpg';
		var frs = fs.createReadStream(filename, {flags:'r'});
		var session = client.createSession('FILE', [filename]);
		session.on('end', () => process.exit(0));
		frs.pipe(sendCounter).pipe(session);
	});
}

var appType = process.argv[2];

if ( appType === 'server' )
{
	startServer();
}
else if ( appType === 'client' )
{
	startClient();
}
else
{
	console.log(`${process.argv[0]} ${process.argv[1]} (client|server)`);
}