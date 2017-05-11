// jshint esversion: 6
/**
 * http://usejsdoc.org/
 */

'use strict';

const util = require('util');
const EventEmitter = require('events');
const stream = require('stream');
const rnju = require('@rankwave/nodejs-util');
const textParser = require('./text-parser');

const Duplex = stream.Duplex;
const msg2str = textParser.msg2str;
const getOption = rnju.common.getOption;

/*
	SESS [tid] [body_length] [session_id] [flags] [protocol] [args...]
	
	- session_id: 
		- server: odd number
		- client: even number
	
	- flags
		- S: Start Session
		- F: End Session (Bidirectional)
		- R: Refuse Session
		- P: Push Data
	
	- protocol
		- HTTP
 */

const EOF = {};

class Session extends Duplex
{
	_read(size)
	{
		if ( this.debugSession )
		{
			console.log(util.format('session[%s] _read(%s)', this.session_id, size));
		}
		this.__read(size);
	}
	
	__read(size)
	{
		while ( this._recvBuffers.length > 0 )
		{
			var msg = this._recvBuffers.shift();
			if ( msg === EOF )
			{
				if ( this.debugSession )
				{
					console.log(util.format('push[%s] null', this.session_id));
				}
				
				this.push(null);
			}
			else
			{
				if ( this.debugSession )
				{
					console.log(util.format('push[%s] %d', this.session_id, msg.body.length));
				}
				
				this.bytesRead += msg.body.length;
				
				if ( !this.push(msg.body) )
				{
					break;
				}
			}
		}
	}
	
	_write(chunk, encoding, callback)
	{
		this._sessionManager._sendPSH(this, chunk, false, callback);
		
		var nWrite = Buffer.isBuffer(chunk) ? chunk.length : 
			typeof(chunk) === 'string' ? Buffer.byteLength(chunk, encoding) : 
				0;

		this.bytesWritten += nWrite;
		
		this._updateTimeout();
	}
	
	_writev(chunks, callback)
	{
		for ( var i = 0 ; i < chunks.length ; i++ )
		{
			var entry = chunks[i];
			var isLast = i + 1 === chunks.length; 
			this._write(entry.chunk, entry.encoding, isLast ? callback : null);
		}
	}
	
	_onMessage(msg)
	{
		this._updateTimeout();
		
		if ( msg === EOF || (msg.body && msg.body.length > 0) )
		{
			this._recvBuffers.push(msg);
			if ( this.debugSession )
			{
				console.log(util.format('session[%d] isPaused: %s', this.session_id, this.isPaused()));
			}
			this.__read(0);
		}
	}
	
	_onError(e)
	{
		this._updateTimeout();
		this.emit('error', e);
	}
	
	_onEnd(msg)
	{
		this._onMessage(EOF);
	}
	
	_onFinish()
	{
		this._updateTimeout();
		this._sessionManager._sendPSH(this, null, true);
	}
	
	_onClose(e)
	{
		this._clearTimeout();
		this.destroyed = true;
		this.endInput = true;
		this.endOutput = true;
		this.emit('close', e);
	}
	
	_onTimeout()
	{
		this._timer = null;
		this._timeout = 0;
		this.emit('timeout');
	}
	
	_updateTimeout()
	{
		if ( this._timeout > 0 )
		{
			if ( this._timer )
			{
				clearTimeout(this._timer);
			}
			
			this._timer = setTimeout(() => this._onTimeout(), this._timeout);
		}
	}
	
	_clearTimeout()
	{
		if ( this._timer )
		{
			clearTimeout(this._timer);
			this._timer = null;
			this._timeout = 0;
		}
	}
	
	setTimeout(timeout, callback)
	{
		this._clearTimeout();

		if ( timeout > 0 )
		{
			if ( callback )
			{
				this.on('timeout', callback);
			}
			this._timeout = timeout;
			this._timer = setTimeout(() => this._onTimeout(), this._timeout);
		}

		return this;
	}
	
	destroy(e)
	{
		this._sessionManager._destroySession(this.session_id);
	}
	
	constructor(_sessionManager, options)
	{
		super(options);
		this._sessionManager = _sessionManager;
		this.address = _sessionManager.client.address;
		this._recvBuffers = [];
		this._endInput = false;
		this._endOutput = false;
		this._everPushed = false;
		this._isActive = options.isActive;
		this.session_id = options.session_id;
		this.protocol = options.protocol;
		this.session_args = options.session_args;
		this.debugSession = getOption(options, 'debugSession', false);
		this.logSession = getOption(options, 'logSession', true);
		this.bytesRead = 0;
		this.bytesWritten = 0;
		this.startMillis = Date.now(); 
		this.options = options;
		this._timer = null;
		this._timeout = 0;
		this.destroyed = false;
		this.on('finish', () => this._onFinish());
	}
}

class SessionListener extends EventEmitter
{
	constructor(options)
	{
		super();
		this.protocol = options.protocol;
		this.debugSession = getOption(options, 'debugSession', false);
		this.logSession = getOption(options, 'logSession', true);
		this.options = options;
	}
	
	_onSession(session)
	{
		this.emit('session', session);
	}
}

class SessionManager extends EventEmitter
{
	_getSession(session_id)
	{
		return session_id && this.sessionMap.hasOwnProperty(session_id) ?
			this.sessionMap[session_id] : null;
	}
	
	_addSession(session_id, session)
	{
		if ( this.logSession )
		{
			console.log(util.format('SESS ADD %s %s %s %s', 
					(session._isActive ? 'ACTV' : 'PASV'), 
					session_id,
					session.protocol, 
					session.session_args));
		}
		
		this.sessionMap[session_id] = session;
	}
	
	_delSession(session_id, e)
	{
		var session = this.sessionMap[session_id];
		
		if ( session )
		{
			delete this.sessionMap[session_id];
			
			if ( e )
			{
				session._onError(e);
			}
			
			session._onClose();
			
			if ( this.logSession )
			{
				console.log(util.format('SESS DEL %s %s %s %s %s %s %s', 
						(session._isActive ? 'ACTV' : 'PASV'), 
						session_id,
						session.protocol, 
						session.session_args, 
						session.bytesRead,
						session.bytesWritten,
						(Date.now() - session.startMillis)));
			}
		}
	}
	
	_destroySession(session_id)
	{
		var session = this.sessionMap[session_id];
		
		if ( session )
		{
			if ( this.debugSession )
			{
				console.log("_destroySession _sendRST");
			}
			this._sendRST(session_id);
		}
		
		this._delSession(session_id);
	}
	
	_getAllSessionIds()
	{
		return Object.keys(this.sessionMap);
	}
	
	_getListener(protocol)
	{
		return protocol && this.listenerMap.hasOwnProperty(protocol) ? 
				this.listenerMap[protocol] : null;
	}
	
	_onSessionCommand(msg)
	{
		var session_id = msg.args[0];
		var flags = msg.args[1] ? msg.args[1] : '';
		var protocol = msg.args[2];
		var session_args = msg.args.slice(3);
		
		if ( !session_id )
		{
			if ( this.logSession )
			{
				console.log('SESS Invalid session id: ' + session_id);
			}
			return;
		}
		
		var session = this._getSession(session_id);
		
		// RST
		
		if ( flags.includes('R') )
		{
			if ( session )
			{
				this._delSession(session_id, new Error('Remote session is closed.'));
			}
		}
		else
		{
			var pushed = false;
			
			// SYN 
			
			if ( flags.includes('S') )
			{
				if ( session )
				{
					if ( this.debugSession )
					{
						console.log("_onSessionCommand 'S' _sendRST");
					}
					this._sendRST(session_id);
				}
				else
				{
					if ( !protocol )
					{
						if ( this.logSession )
						{
							console.log('SESS Invalid session protocol: ' + protocol);
						}
						this._sendRST(session_id);
						return;
					}
					
					var listener = this._getListener(protocol);
					
					if ( !listener )
					{
						if ( this.logSession )
						{
							console.log('SESS No listener registered for protocol: ' + protocol);
						}
						this._sendRST(session_id);
						return;
					}
					
					var session_options = Object.assign({}, this.options, {isActive: false, session_id: session_id, protocol: protocol, session_args: session_args});
					session = new Session(this, session_options);
					this._addSession(session_id, session);
					listener._onSession(session);
					session._onMessage(msg);
					pushed = true;
				}
			}
			
			// FIN
			
			if ( flags.includes('F') )
			{
				if ( session )
				{
					if ( !pushed )
					{
						session._onMessage(msg);
						pushed = true;
					}
					session._onEnd(msg);
					session._endInput = true;
					if ( session._endOutput )
					{
						this._delSession(session_id);
					}
				}
				else
				{
					if ( this.debugSession )
					{
						console.log("_onSessionCommand 'F' _sendRST");
					}
					this._sendRST(session_id);
				}
			}
			
			// PUSH
			
			if ( !pushed )
			{
				if ( session )
				{
					session._onMessage(msg);
					pushed = true;
				}
				else
				{
					if ( this.debugSession )
					{
						console.log("_onSessionCommand 'P' _sendRST");
					}
					this._sendRST(session_id);
				}
			}
		}
	}
	
	_sendRST(session_id)
	{
		this.client.sendMessage('SESS', -1, [session_id, 'R'], null);
	}
	
	_sendPSH(liveSession, chunk, end, callback)
	{
		var flags = '';
		var session_id = liveSession.session_id;
		var session = this._getSession(session_id);
		var session_args = liveSession.session_args;
		
		if ( session )
		{
			if ( !session._everPushed && session._isActive )
			{
				flags += 'S';
			}
			
			if ( end )
			{
				flags += 'F';
			}
			
			if ( flags === '' )
			{
				flags = 'P';
			}
			
			var args = [session_id, flags];
			
			if ( flags.includes('S') )
			{
				args.push(liveSession.protocol);
				if ( session_args )
				{
					args.push(...session_args);
				}
			}
			
			session._everPushed = true;
			
			this.client.sendMessage('SESS', -1, args, chunk, callback);
			
			if ( end )
			{
				session._endOutput = true;
				if ( session._endInput )
				{
					this._delSession(session_id);
				}
			}
		}
		else
		{
			liveSession.emit('error', new Error(util.format('session[%s] does not exist.', session_id)));
		}
	}
	
	_closeAllSessions(e)
	{
		this._getAllSessionIds().forEach((session_id) => {
			this._delSession(session_id, e);
		});
	}

	createSession(options)
	{
		var session_id = '' + this.sessionIdCounter;
		this.sessionIdCounter += 2;
		var session_options = Object.assign({}, this.options, options, {isActive: true, session_id: session_id, protocol: options.protocol, session_args: options.session_args});
		var session = new Session(this, session_options);
		this._addSession(session_id, session);
		return session;
	}
	
	registerListener(listener)
	{
		this.listenerMap[listener.protocol] = listener;
	}
	
	constructor(client, options)
	{
		super();
		this.client = client;
		this.sessionIdCounter = client.isServer ? 1 : 2;
		this.sessionMap = {};
		this.listenerMap = {};
		this.debugSession = getOption(options, 'debugSession', false);
		this.logSession = getOption(options, 'logSession', true);
		this.options = options;
		
		client.on('SESS', (msg) => { 
			this._onSessionCommand(msg);
		});
		
		client.on('close', () => {
			this._closeAllSessions();
		});
		
		client.on('error', (e) => {
			this._closeAllSessions(e);
		});
	}
}

module.exports = {
		Session: Session,
		SessionListener: SessionListener,
		SessionManager: SessionManager
};
