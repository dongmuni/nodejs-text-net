# nodejs-text-net

Text-base (like SMTP) client-server module. supporting multi worker clients, woker-server ping keep-alive, worker load-balancing, session-tunneling.

-----

# Text-Net Protocol

### Message Format

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
# Examples

## Simple client/server send & receive message

* In the following example, the client connects to the server and sends a message with the 'NTFY' command, and the server receives the 'NTFY' command message and prints it to the screen.

### server

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

### client

```
const textNet = require('@rankwave/nodejs-text-net');

var client = textNet.connect({host: 'localhost', port: 1234, logConnection: false, logError: false});

/* command, tid, args, body */

client.sendMessage('NTFY', 0, ['arg1', 'arg2'], 'Hello World!');
```

### server output

```
listening
client connected
args: arg1,arg2
body: Hello World!
```

## Simple client request, server response

* In the example below, when the client connects to the server and requests the current time with the 'TIME' command, the server returns the current time in UTC string.

### server

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

### client

```
const textNet = require('@rankwave/nodejs-text-net');

var client = textNet.connect({host: 'localhost', port: 1234, logConnection: false, logError: false});

/* command, args, body, timeout (ms), response callback */

client.sendRequest('TIME', null, null, 10000, (msg) => {
	console.log(msg.args[0]);
});
```

### client output

```
Wed, 10 May 2017 09:07:22 GMT
```

## Automatically close idle clients on the server

* On the server, to clean up a client that does not have an in/out for a certain amount of time, specify the 'idleCloseTimeout' property in milliseconds in the options of createServer() as shown below.

```
	var server = textNet.createServer({
		logConnection: false, 
		logError: false, 
		idleCloseTimeout: 5000});
```

## Keeping clients connected to the server

* As shown in the example above, to prevent the server from cleaning up idle clients, the client can periodically send a keep-alive message using the 'PING' command. 'PING' is a reserved command for the **text-net** protocol. The server does not do any special processing for the 'PING' command and does not emit the 'PING' event. To set the 'PING' command transmission interval, you can specify the 'idlePingTimeout' property in milliseconds in the options of the connect() function.

```
	var client = textNet.connect({
		host: 'localhost', 
		port: 1234, 
		logConnection: false, 
		logError: false, 
		idlePingTimeout: 3000});
```