# nodejs-text-net

Text-base (like SMTP) client-server module. supporting multi worker clients, woker-server ping keep-alive, worker load-balancing, session-stream.

-----

# Text-Net Protocol

## Message Format

	<code> <tid> <body-length> [<arg> ...]
	<body>
	
###### code

* request command : 3~5 digit alphanumeric chars. (Must be upper case, starting with alphabet) 
* response code : 3~5 digit numeric chars.

###### tid

* '0' means notify or command not requiring response.
* Generally use a serial number greater than 1.
* Generally use same tid on request/response pair. 

###### body-length, body

* Text or Binary data

###### arg

* Message argument
* Since SPACE(s) are delimiters, each argument must be percent(%) encoded, so that it does not contain SPACE, CR, LF, or '%'.

##### Message Format Example
	> WGET 13 0 https://github.com
	
	< 100 13 5437 200 OK
	< <html> ..... </html>


-----

# Simple Client/Server Examples

## Client send & Server receive message

* In the following example, the client connects to the server and sends a message with the 'NTFY' command, and the server receives the 'NTFY' command message and prints it to the screen.

##### server.js

```
const textNet = require('@rankwave/nodejs-text-net');

var server = textNet.createServer({logConnection: false, logError: false});

server.listen({port: 1234}, () => {
	console.log('listening');
});

server.on('client', (client) => {
	console.log('client connected');
	
	client.on('error', (e) => {
		console.log(e);
	});
	
	/* To handle command, register callback with event emitter's on() method */
	
	client.on('NTFY', (msg) => {
		console.log('args: ' + msg.args);
		console.log('body: ' + msg.body.toString());
	});
});
```

##### client.js

```
const textNet = require('@rankwave/nodejs-text-net');

var options = {host: 'localhost', port: 1234, logConnection: false, logError: false};

var client = textNet.connect(options, () => {
		/* command, tid, args, body */
		client.sendMessage('NTFY', 0, ['arg1', 'arg2'], 'Hello World!');
	});

```

##### server output

```
listening
client connected
args: arg1,arg2
body: Hello World!
```

## Client request, Server response

* In the example below, when the client connects to the server and requests the current time with the 'TIME' command, the server returns the current time in UTC string.

##### server.js

```
const textNet = require('@rankwave/nodejs-text-net');

var server = textNet.createServer({logConnection: false, logError: false});

server.listen({port: 1234}, () => {
	console.log('listening');
});

server.on('client', (client) => {
	console.log('client connected');
	
	client.on('error', (e) => {
		console.log(e);
	});
	
	client.on('TIME', (msg) => {
		/* response with '100' code, same request 'tid', time to first argument */
		client.sendMessage('100', msg.tid, [new Date().toUTCString()]);
	});
});
```

##### client.js

```
const textNet = require('@rankwave/nodejs-text-net');

var options = {host: 'localhost', port: 1234, logConnection: false, logError: false};

var client = textNet.connect(options, () => {
	/* command, args, body, timeout (ms), response callback */
	client.sendRequest('TIME', null, null, 10000, (msg) => {
		console.log(msg.args[0]);
	});
});

```

##### client output

```
Wed, 10 May 2017 09:07:22 GMT
```

-----

# Clean-up & Keep-Alive & Auto Reconnect Connection 

## Automatically close idle clients on the server

* On the server, to clean up a client that does not have an in/out for a certain amount of time, specify the **'idleCloseTimeout'** property (in milliseconds) in the options of createServer() as shown below.

```
var server = textNet.createServer({
	logConnection: false, 
	logError: false, 
	idleCloseTimeout: 5000});
```

## Keeping clients connected to the server

* As shown in the example above, to prevent the server from cleaning up idle clients, the client can periodically send a keep-alive message using the 'PING' command. 'PING' is a reserved command for the **text-net** protocol. The server does not do any special processing for the 'PING' command and does not emit the 'PING' event. To set the 'PING' command transmission interval, you can specify the **'idlePingTimeout'** property (in milliseconds) in the options of the connect() function.

```
var client = textNet.connect({
	host: 'localhost', 
	port: 1234, 
	logConnection: false, 
	logError: false, 
	idlePingTimeout: 3000});
```

* The 'IdleCloseTimeout' and 'idlePingTimeout' are generally not used, if the client and server are configured in the same network. There is a gateway between the client and the server and can be used to prevent the gateway from automatically shutting down or blowing idle connections.

## Automatically Reconnect to the server

* If the connection to the server is lost, the client can automatically reconnect. It may attempt to reconnect periodically, if the server is restared and disconnected, or if it is unable to connect to the server due to network problems. You can adjust the reconnect interval by specifying the **'reconnectInterval'** property (in milliseconds) in the options of the autoReconnect() function. 5000 ms if omitted.

```
var options = {
	host: 'localhost', 
	port: 1234, 
	logConnection: false, 
	logError: false, 
	idlePingTimeout: 3000,
	reconnectInterval: 3000
};

textNet.autoReconnect(options, (client) => {
		client.sendMessage('NTFY', 0, ['arg1', 'arg2'], 'Hello World!');
		client.sendRequest('TIME', null, null, 10000, (msg) => {
			console.log(msg.args[0]);
		});
	});
```

-----

# Server & Worker-Pool Model

* A model that consists of one server and several workers, and requests task from the server to the worker. This is useful for distributing tasks (that are difficult to handle on one machine) to multiple machines.

## Example
 
* In the following example, the worker model implements the function of obtaining the hash value of the text. The 'HASH' command reads the body and returns the md5 hash value. The server receives the 'HASH' request from the client, distributes it to the workers, and forwards the response back to the client.

##### hash.js
```
// jshint esversion: 6

'use strict';

const textNet = require('@rankwave/nodejs-text-net');
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
```

##### run server

```
$ node hash.js server
```

##### run worker (3 times)

```
$ node hash.js worker
```
	
##### run client & output
```
$ cat data.txt
1. 'Cause babe, I'll do it all over you
2. A cat, she's got nine lives
3. A millionaire's got a million dollars
4. A-doin' what I want to do
5. After all my liquor's been drunk
6. After all my thoughts have been thunk
7. After my dreams are dreamed out
8. And I grab me a pint, you know that I'm a giant
9. And I tell you on the side, that you better run and hide

$ cat data.txt | node hash.js client
1 0e4dfe16951bbb6926b7ce4a73741b1e: 1. 'Cause babe, I'll do it all over you
4 90ed2126b15c8af484275acac6fea161: 4. A-doin' what I want to do
7 50d98f64b035295610ba2fb34dd9d249: 7. After my dreams are dreamed out
2 4374ce04813486d4ed52a5d0d5c27a89: 2. A cat, she's got nine lives
5 8357d4112e12dc75c2648e6cd3b08744: 5. After all my liquor's been drunk
8 d6f1110faf47583a13d5744e669f1f0a: 8. And I grab me a pint, you know that I'm a giant
3 cffdb70f5cef7cad6b3ed3ed3687d02b: 3. A millionaire's got a million dollars
6 e8f8184655bfcd04652c8ff72ea17375: 6. After all my thoughts have been thunk
9 cc2c2fd2acb050d394002696e8534366: 9. And I tell you on the side, that you better run and hide
```

##### worker-1 output
```
$ node hash.js worker
0e4dfe16951bbb6926b7ce4a73741b1e: 1. 'Cause babe, I'll do it all over you
90ed2126b15c8af484275acac6fea161: 4. A-doin' what I want to do
50d98f64b035295610ba2fb34dd9d249: 7. After my dreams are dreamed out
```

##### worker-2 output
```
$ node hash.js worker
4374ce04813486d4ed52a5d0d5c27a89: 2. A cat, she's got nine lives
8357d4112e12dc75c2648e6cd3b08744: 5. After all my liquor's been drunk
d6f1110faf47583a13d5744e669f1f0a: 8. And I grab me a pint, you know that I'm a giant
```

##### worker-3 output
```
$ node hash.js worker
cffdb70f5cef7cad6b3ed3ed3687d02b: 3. A millionaire's got a million dollars
e8f8184655bfcd04652c8ff72ea17375: 6. After all my thoughts have been thunk
cc2c2fd2acb050d394002696e8534366: 9. And I tell you on the side, that you better run and hide
```

## Code Explanation


* If you set **'autoRegister'** property to true in the options of connect() or autoReconnect() function, The client sends the 'RGST' command after connecting to the server. The 'RGST' command means, "I am a worker and I am ready to do some task."
* When the server receives the 'RGST' command, the startWorkerPoolServer() function puts the client into the worker pool. When a connection is lost, it is automatically removed client from the worker pool.
* The workerPool's sendMessage() and sendRequest() functions are the same as client's sendMessage() and sendRequest(), which call real sendMessage() and sendRequest() by assigning the client in the worker pool as round-robin.


```
// client
textNet.autoReconnect(opt({host: 'localhost', port: 1234, autoRegister: true}), (client) => {
	...
});

// server
var workerPool = textNet.startWorkerPoolServer(opt({port: 1234}), () => {
	...
});
```

-----

# Session Stream over Text-Net

* Let's say you have a chat application that uses only one connection between client servers. Since a typical conversation message is small in size, it is usually possible to send one text-net message. If you want to send a large photo during a conversation, and you have to use an existing connection, what should you do? If the file is wrapped in a single message, the implementation will be simple, but you will not be able to send the conversation until all the files have been transferred. How do I get a conversation while I'm sending a file? If you cut the file and divide it several times, you can talk.
* To deal with such problem, we created a session stream similar to a TCP connection on a text-net connection. Basically, the structure of a packet uses a text-net connection, but it can open multiple streams simultaneously on a single connection by marking the beginning and end of the session stream.


## Example

* In the following example, the client connects to the server and sends a file named 'image.jpg', and the server receives the file and stores it in the 'recv' directory with the same file name.

```
// jshint esversion: 6

'use strict';

const textNet = require('@rankwave/nodejs-text-net');
const rnju    = require('@rankwave/nodejs-util');
const fs      = require('fs');

const ByteCounter = rnju.stream.ByteCounter;

function opt(options)
{
	return Object.assign({
		debugHeader: false, 
		logConnection: false, 
		logError: false, 
		logSession: true, 
		debugSession: false}, 
		options);
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
			var recvCounter = new ByteCounter(() => 
				console.log(`recv ${recvCounter.bytesPiped} bytes`));
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
		var sendCounter = new ByteCounter(() => 
			console.log(`send ${sendCounter.bytesPiped} bytes`));
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
```

## Code Explanation

```
var session = client.createSession('FILE', [filename]);
```

* The createSession() function actively creates a session above text-net. The first argument is the protocol, which promises what type of data to transfer between client and server. The second argument is used to append an additional description of the additional session itself (called **session arguments**). Because session is basically a stream, it is used to convey additional information that is difficult to include in the stream.

```
client.onSession('FILE', (session) => {
	...
});
```

* The onSession() function is used to handle passive session creation events when the other party creates a session on text-net. The first argument should be the same as the client with the protocol. The second argument is the event handler that will handle the created session. The session arguments can be retrieved with **'session.session_args'** property.


## 'SESS' Command Message Format

```
SESS <tid> <body-length> <flag> <session-id> <protocol> [<session-arg> ...]
<body>
```

##### flag

* Similar to TCP flags, the flags of each session message, with four flags: (S | F | P | R)
* Syn: Start of session stream. Only specified on the Active Open side. The message can have body.
* Fin: End of session stream. Because it is a Duplex stream, both Active and Passive Open can be specified. The message can have body.
* Push: Attached without S / F / R. Generally, specify a message with data. The message can have body.
* Reset: If the session does not exist, it is specified to notify the other party. The message can not have body.

##### session-id

* The key value to identify the session.

##### protocol

* When processing a passive session, you specify to promise each other what content is in the session.

##### session-arg

* Used to send additional data that is difficult to specify in the session stream.