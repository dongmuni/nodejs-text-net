// jshint esversion: 6

'use strict';

const textNet = require('@dongmuni/nodejs-text-net');
const crypto = require('crypto');
const readline = require('readline');

function opt(options)
{
	return Object.assign({logConnection: false, logError: false}, options);
}

function startServer()
{
	// listen for workers
	var workerPool = textNet.startWorkerPoolServer(opt({port: 1234}), () => {
		console.log('listening for workers');
	});
	
	// listen for client
	var server = textNet.createServer();
	server.listen(opt({port: 1235}), () => {
		console.log('listening for clients');
	});
	
	// bypass client request to workers
	server.on('client', (client) => {
		client.on('HASH', (req) => {
			workerPool.sendRequest('HASH', req.args, req.body, 30000, (res) => {
				client.sendMessage(res.code, req.tid, res.args, res.body);
			});
		});
		client.on('error', (e) => {
		});
	});
}

function startWorker()
{
	// Hash the body and return it as the first arg.  
	textNet.autoReconnect(opt({host: 'localhost', port: 1234, autoRegister: true}), (client) => {
		client.on('HASH', (req) => {
			var md5 = crypto.createHash('md5');
			md5.update(req.body);
			var hash = md5.digest('hex');
			console.log(`${hash}: ${req.body.toString()}`);
			client.sendMessage('100', req.tid, [hash]);
		});
	});
}

function startClient()
{
	var reqCnt = 0;
	var isEnd = false;
	
	var client = textNet.connect(opt({host: 'localhost', port: 1235}), () => {
		
		// Reads a message from stdin line by line and requests a hash
		const rl = readline.createInterface({input: process.stdin});

		rl.on('line', (line) => {
			if ( line )
			{
				reqCnt++;
				client.sendRequest('HASH', null, line, 30000, (res) => {
					reqCnt--;
					console.log(`${res.tid} ${res.args[0]}: ${line}`);
					if ( isEnd && reqCnt === 0 )
					{
						process.exit(0);
					}
				});
			}
		});
		
		rl.on('close', () => {
			isEnd = true;
		});
	});
}

var appType = process.argv[2];

if ( appType === 'server' )
{
	startServer();
}
else if ( appType === 'worker' )
{
	startWorker();
}
else if ( appType === 'client' )
{
	startClient();
}
else
{
	console.log(`${process.argv[0]} ${process.argv[1]} (client|server|worker)`);
}
