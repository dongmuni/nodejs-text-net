// jshint esversion: 6

'use strict';

const net 			= require('net');
const events 		= require('events'); 
const util 			= require('util');
const stream		= require('stream');
const os			= require('os');
const rnju			= require('@rankwave/nodejs-util');

const textParser	= require('./text-parser');
const textSession 	= require('./text-session');

const msg2str 			= textParser.msg2str;
const getOption 		= rnju.common.getOption;
const encodeArgs 		= rnju.encoder.encodeArgs;
const Session 			= textSession.Session;
const SessionListener	= textSession.SessionListener;
const SessionManager	= textSession.SessionManager;

/*************************************************************************************************/

function Client(rwStream, options)
{
	events.EventEmitter.call(this);
	
	var tidCounter = 0;
	var requestMap = {};
	var isClosed = true;
	var address = '';
	var host = '';
	
	var idlePingTimeout 	= getOption(options, 'idlePingTimeout',		0);
	var idleCloseTimeout	= getOption(options, 'idleCloseTimeout',	0);
	var autoRegister		= getOption(options, 'autoRegister', 		false);
	var logConnection		= getOption(options, 'logConnection', 		true);
	var autoResponseUnhandledCommand = getOption(options, 'autoResponseUnhandledCommand', true);
	
	this.isServer = options.isServer;
	
	function getAddress()
	{
		return util.format('%s:%s', rwStream.remoteAddress.replace(/^::ffff:/i, ''), rwStream.remotePort);		
	}
	
	function log(event)
	{
		if ( logConnection )
		{
			console.log(util.format('%s %s(%s)', event, host, address));
		}
	}
	
	this.closeStream = function() {

		//console.log('isClosed ' + isClosed);
		
		if ( !isClosed )
		{
			isClosed = true;
			
			log('CLOSE');
			
			if ( rwStream instanceof stream.Writable )
			{
				rwStream.end();
			}
		
			for ( var tid in requestMap )
			{
				if ( requestMap.hasOwnProperty(tid) )
				{
					clearTimeout(requestMap[tid].timer);
					requestMap[tid].callback({code: '500', tid: tid, args: ['socket_closed'], body: null, isValid: true});
					delete requestMap[tid];
				}
			}
			
			this.emit('close');
		}
	};
	
	if ( rwStream instanceof stream.Writable )
	{
		this.sendMessage = function(code, tid, args, body, callback) {
			var bodyBuf = Buffer.isBuffer(body) ? body : 
				typeof(body) === 'string' ? Buffer.from(body) : 
					null;
			tid = tid === -1 ? ++tidCounter : tid;
			tid = '' + tid;
			var bodyLen = bodyBuf ? bodyBuf.length : 0;
			var header = util.format('%s %s %d%s\r\n', code, tid, bodyLen, encodeArgs(args));
			var headerLen = Buffer.byteLength(header);
			var msg = {code: code, tid: tid, args: args, body: body};
			if ( options.debugHeader )
			{
				console.log("send msg: %s", msg2str(msg));
			}
			rwStream.write(header, callback);
			if ( bodyLen > 0 )
			{
				rwStream.write(bodyBuf);
			}
		};

		this.sendRequest = function(code, args, body, timeout, callback) {
			var tid = ++tidCounter;
			this.sendMessage(code, tid, args, body);
			requestMap[tid] = {
				callback: callback,
				timer: setTimeout(() => this.emit('message_timeout', tid), timeout)
			};
		};
	}
	
	if ( rwStream instanceof stream.Readable )
	{
		var parser = textParser.createParser((msg) => {

			if ( options.debugHeader )
			{
				console.log("recv msg: %s", msg2str(msg));
			}

			if ( !msg.isValid && this.sendMessage )
			{
				this.sendMessage('201', 0, 'invalid_command');
			}
			else
			{
				if ( /^\d+$/.test(msg.code) )
				{
					var tid = msg.tid !== null && /^\d+$/.test(msg.tid) ? msg.tid * 1 : 0;
					
					if ( tid > 0 )
					{
						if ( requestMap.hasOwnProperty(msg.tid) )
						{
							clearTimeout(requestMap[msg.tid].timer);
							requestMap[msg.tid].callback(msg);
							delete requestMap[msg.tid];
						}
						else
						{
							console.log(util.format('ERR dangling response: %s %s [%s]', msg.code, msg.tid, msg.args.join(' ')));
						}
					}
					else
					{
						console.log(util.format('ERR invalid tid: %s %s [%s]', msg.code, msg.tid, msg.args.join(' ')));
					}
				}
				else
				{
					var isHandled = false;
					
					if ( this.listenerCount(msg.code) > 0 )
					{
						isHandled = true;
						this.emit(msg.code, msg);
					}
					
					if ( this.listenerCount('message') > 0 )
					{
						isHandled = true;
						this.emit('message', msg);
					} 
					
					if ( !isHandled && autoResponseUnhandledCommand && this.sendMessage )
					{
						this.sendMessage('201', msg.tid, 'unknown_command');
					}
				}
			}
		});
		
		rwStream.on('data', (data) => {
			parser.feed(data);
		});
		
		rwStream.on('end', (e) => {
			this.closeStream();
		});
	}
	
	if ( rwStream instanceof net.Socket )
	{
		if ( !rwStream.connecting )
		{
			this.address = address = getAddress();
			isClosed = false;
			log('ACCEPT');
		}

		if ( idlePingTimeout > 0 )
		{
			rwStream.setTimeout(idlePingTimeout);
		}
		else if ( idleCloseTimeout > 0 )
		{
			rwStream.setTimeout(idleCloseTimeout);
		}
		
		rwStream.on('timeout', () => {
			if ( idlePingTimeout > 0 )
			{
				this.sendMessage('PING', 0, [], null);
				log('PING');
			}
			else if ( idleCloseTimeout > 0 )
			{
				this.closeStream();
			}
			else
			{
				this.emit('timeout');
			}
		});
		
		rwStream.on('connect', () => {
			this.address = address = getAddress();
			isClosed = false;
			log('CONNECT');
			if ( autoRegister )
			{
				this.sendMessage('RGST', 0, os.hostname());
				log('RGST');
			}
			this.emit('connect');
		});
		
		rwStream.on('close', (had_error) => {
			this.closeStream();
		});
		
		this._getSessionManager = function() {
			if ( !this.sessionManager )
			{
				this.sessionManager = new SessionManager(this, options);
			}
			return this.sessionManager;
		};
		
		this.onSession = function(protocol, callback) {
			var smgr = this._getSessionManager();
			var listener_options = Object.assign({}, options, {protocol: protocol});
			var slnr = new SessionListener(listener_options);
			slnr.on('session', callback);
			smgr.registerListener(slnr);
		};
		
		this.createSession = function(protocol, session_args) {
			var smgr = this._getSessionManager();
			var session_options = Object.assign({}, options, {protocol: protocol, session_args: session_args});
			return smgr.createSession(session_options);
		};
	} 
	
	rwStream.on('error', (e) => {
		log('ERROR ' + e.message);
		this.closeStream();
		this.emit('error', e);
	});
	
	this.on('message_timeout', (tid) => {
		if ( requestMap.hasOwnProperty(tid) )
		{
			requestMap[tid].callback({code: '500', tid: tid, args:['message_timeout'], body: null, isValid: true});
			delete requestMap[tid];
		}
	});
	
	this.on('RGST', (msg) => {
		host = msg.args.length > 0 ? msg.args[0] : '';
		log('RGST');
	});
	
	this.on('PING', (msg) => {
		log('PING');
	});
}

util.inherits(Client, events.EventEmitter);

/*************************************************************************************************/

function Server(server, options)
{
	events.EventEmitter.call(this);
	
	this.listen = function(options, callback) {
		server.listen(options, callback);
	};
	
	server.on('connection', (socket) => {
		options = options || {};
		options.isServer = true;
		this.emit('client', new Client(socket, options));
	});
}

util.inherits(Server, events.EventEmitter);

function createServer(options)
{
	return new Server(net.createServer(), options);
}

/*************************************************************************************************/

function connect(options, connectListener)
{
	var socket = net.connect(options, () => {
		if ( connectListener )
		{
			connectListener();
		}
	});
	
	return new Client(socket, options);
}

/*************************************************************************************************/

function autoReconnect(options, connectionListener)
{
	var reconnectInterval = getOption(options, 'reconnectInterval', 5000);

	var reconnector = new events.EventEmitter();

	function reconnect()
	{
		var client = connect(options);
		var isReconnecting = false;
		
		function tryReconnecting()
		{
			if ( !isReconnecting )
			{
				isReconnecting = true;
				reconnector.emit('close');
			}
		}

		client.on('connect', () => {
			connectionListener(client);
		});

		client.on('close', () => {
			tryReconnecting();
		});

		client.on('error', (e) => {
			tryReconnecting();
		});
	}

	reconnector.on('close', () => {
		setTimeout(() => reconnector.emit('reconnect'), reconnectInterval);
	});

	reconnector.on('reconnect', () => {
		reconnect();
	});
	
	reconnect();
}

/*************************************************************************************************/

function createWorkerPool(options)
{
	var clientSet = new Set();
	var clientArr = [];
	var counter = 0;
	var logConnection = getOption(options, 'logConnection', true);
	
	function resetClients()
	{
		if ( logConnection )
		{
			console.log('CLIENTS ' + clientSet.size);
		}
		clientArr = [];
		if ( clientSet.size > 0 )
		{
			clientSet.forEach((client) => clientArr.push(client));
		}
	}
	
	function addClient(client)
	{
		clientSet.add(client);
		resetClients();
	}
	
	function deleteClient(client)
	{
		if ( clientSet.has(client) )
		{
			clientSet.delete(client);
			resetClients();
		}
	}
	
	function getNextClient()
	{
		var idx = counter++ % clientArr.length;
		return clientArr[idx];
	}
	
	function sendRequest(cmd, args, body, timeout, callback)
	{
		if ( clientArr.length === 0 )
		{
			callback({code: '500', tid: 0, args: ['no_workers'], body: null, isValid: true});
		}
		else
		{
			getNextClient().sendRequest(cmd, args, body, timeout, callback);
		}
	}
	
	function sendMessage(cmd, tid, args, body)
	{
		if ( clientArr.length > 0 )
		{
			getNextClient().sendMessage(cmd, tid, args, body);
		}
	}
	
	function createSession(protocol, session_args)
	{
		if ( clientArr.length > 0 )
		{
			return getNextClient().createSession(protocol, session_args);
		}
		else
		{
			throw new Error('There is no worker(s) for session creating');
		}
	}
	
	function getPoolSize()
	{
		return clientSet.size;
	}
	
	return {
		addClient: addClient,
		deleteClient: deleteClient,
		getNextClient: getNextClient,
		sendRequest: sendRequest,
		sendMessage: sendMessage,
		createSession: createSession,
		getPoolSize: getPoolSize
	};
}

/*************************************************************************************************/

function startWorkerPoolServer(options, listenCallback)
{
	var workerPool = createWorkerPool();
	var server = createServer(options);
	var logConnection = getOption(options, 'logConnection', true);
	var port = getOption(options, 'port', 0);

	server.on('client', (client) => {
		
		client.on('RGST', (msg) => {
			workerPool.addClient(client);
		});
		
		client.on('error', (e) => {
			workerPool.deleteClient(client);
		});
		
		client.on('close', () => {
			workerPool.deleteClient(client);
		});
	});
	
	server.listen({port: port}, () => {
		if ( logConnection )
		{
			console.log('LISTEN ' + port);
		}
		if ( listenCallback )
		{
			listenCallback(server);
		}
	});
	
	return workerPool;
}

/*************************************************************************************************/

var defaultOptions = {
	idlePingTimeout: 0,
	idleCloseTimeout: 0,
	autoRegister: false,
	reconnectInterval: 5000,
	logConnection:	true,
	autoResponseUnhandledCommand: true
};

/*************************************************************************************************/
/* add comments 2017/04/12 */

module.exports = {
	Client: Client,
	Server: Server,
	createServer: createServer,
	connect: connect,
	autoReconnect: autoReconnect,
	createWorkerPool: createWorkerPool,
	startWorkerPoolServer: startWorkerPoolServer
};