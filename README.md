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

