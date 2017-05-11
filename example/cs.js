// jshint esversion: 6

'use strict';

const textNet = require('@rankwave/nodejs-text-net');

function startServer()
{
	var server = textNet.createServer({logConnection: false, logError: false, idleCloseTimeout: 5000});
	
	server.listen({port: 1234}, () => {
		console.log('listening');
	});
	
	server.on('client', (client) => {
		console.log('client connected');
		
		client.on('NTFY', (msg) => {
			console.log('args: ' + msg.args);
			console.log('body: ' + msg.body.toString());
		});
		
		client.on('TIME', (msg) => {
			client.sendMessage('100', msg.tid, [new Date().toUTCString()]);
		});
		
		client.on('error', (e) => {
		});
	});
}

function startClient()
{
	textNet.autoReconnect({port: 1234, logConnection: false, logError: false, idlePingTimeout: 3000}, (client) => {
		client.sendMessage('NTFY', 0, ['arg1', 'arg2'], 'Hello World!');
		
		client.sendRequest('TIME', null, null, 10000, (msg) => {
			console.log(msg.args[0]);
		});
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