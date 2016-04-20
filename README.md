# jrpc v3.0.0-alpha

Streaming bidirectional backwards-compatible extended JSON-RPC 2.0 in JavaScript

This rewrite is a full implementation of [JSON-RPC 2.0](http://www.jsonrpc.org/specification) which it extends in useful ways:

- Neither side is a "client" nor a "server" and can emit requests/notifications at any time.
- In line with [XML-RPC's introspection methods](http://scripts.incutio.com/xmlrpc/introspection.html) , the "system" root level name is reserved, which does not interfere with JSON-RPC's "rpc" reservation.
- Backwards-compatible upgrade to extended bimodal message format if both ends support it.

## REWRITE IN PROGRESS

> This document is roughly in its final form, however the module is being rewritten from scratch to implement the changes.  This repo is **not yet usable**.

## Installation & Usage

### Client-side, stand-alone using Bower

```shell
bower install jrpc --save
```

You can then integrate `bower_components/jrpc/jrpc.min.js` to your build as needed.  (The non-minified version is a CommonJS module, not suitable for direct browser use.)  This was generated using `browserify --standalone` and is thus safe as-is or with various module systems.  Stand-alone example:

```html
<script src="jrpc.min.js"></script>
...
<script type="text/javascript"><!--
  var remote = new JRPC({ client: true });
  ...
// --></script>
```

#### Example with browsers' WebSocket

```js
// Expose what the other end can call
remote.expose({
  ping: function(params, next) {
    return next(null, 'pong');
  })
}

// Create a WebSocket connection
var ws = new WebSocket(someURL);

// Hand off whatever WebSocket receives to JRPC
ws.onmessage = function(ev) {
  remote.receive(ev.data);
};

// Queue call the other end's 'foo.bar' method
remote.call('foo.bar', [], function(err, result) {
  if (err) {
    console.log('Something went wring in foo.bar()!');
  } else {
    console.log('foo.bar() returned: ' + result);
  }
});

// Send queued messages a single time
remote.transmit(function(msg, next) {
	try {
	  ws.send(msg);
	  return next(null);
	} catch (e) {
	  return next(true);
	}
});
```

Note that I personally use my small [LongWebSocket](https://www.npmjs.com/package/longwebsocket) wrapper client-side to make sure connections stay alive.


### Node.JS and client-side (CommonJS)

```shell
npm install jrpc --save
```

In Node.JS or if you're using Browserify to bundle CommonJS modules together for client-side use:

```js
var JRPC = require('jrpc');
var remote = new JRPC({ client: true });
...
```

#### Node.JS server with WebSocketServer

On the server side, instead of the global object `WebSocket` you could use the WebSocketServer implementation, and usage stays otherwise the same:

```js
var WebSocketServer = require('ws').Server;
var JRPC = require('jrpc');
var wss = new WebSocketServer(...);

wss.on('connection', function(ws) {
  // Each new connection gets a unique handler
  var remote = new JRPC();

  remote.expose(...);

  ws.on('message', function(msg) {
    remote.receive(msg);
  });

  // Let JRPC send requests and responses continuously
  remote.setTransmitter(function(msg, next) {
    try {
      ws.send(msg);
      return next(null);
    } catch (e) {
      return next(true);
    }
  });
});
```

### Socket.IO

On client and server sides, Socket.IO provides stability, protocol abstraction and channels.  One could perhaps even create multiple JRPC instances to assign to different channels.  The data exchange is otherwise identical to the above WebSocket examples: hand off received messages to `remote.receive()` and relay packets to the communications channel with `remote.setTransmit()`.

### Node.JS parent-child IPC

One could use `process.send()` and `process.on('message')` with JSON-RPC as a multiplexer.

## API

### remote = new JRPC([*options*])

JRPC allows the creation of multiple completely independent instances.  Available options:

**client:** Define and set to true if this end will originate the underlying communications channel.

While this implementation of JSON-RPC is client/server agnostic once a connection is established, under the hood it is useful for it to know which end initiated the connection.  The connecting end is responsible for calling the listening end's `system.listComponents()` as soon as message transmission is available, to make both ends discover each other's extensions beyond JSON-RPC 2.0.

If you are using JRPC on the client side and know in advance that the remote server is **not** JRPC, feel free to avoid this harmless call by skipping `client` entirely.

### remote.setRemoteTimeout(*seconds*)

(Default: 10 seconds.)  When `remote.call()` queues a call for the remote end, a timer is started for this delay.  If a response wasn't received and processed by then, the queued call's return callback is invoked with an error condition and the call is flushed from the queue.  If a response eventually arrives after this time, it will be silently discarded.  This helps ensure that the callback for each call is always invoked, and that the queue doesn't grow indefinitely during network outages.  Deactivate by setting explicitly to zero.

If you expect to deal with network latency, XmlHttpRequest long-poll related delays or network outages, you might want to increase this to 60-120 seconds.

### remote.setLocalTimeout(*seconds*)

(Default: 5 seconds.)  When `remote.receive()` launches exposed methods requested in the JSON-RPC request packet it received, a timer is started for this delay.  If the response callback hasn't fired by then, an error response is sent back and the call is flushed from the queue.  If the response callback does fire later, it will be silently discarded.  This helps ensure that servers always respond explicitly to calls, at the expense of possibly ignoring valid long-running responses.  Deactivate by setting explicitly to zero.

If you expect to deal with computationally-intensive methods, you might want to increase this as appropriate.  Make sure, however, that the other end will wait even longer to allow for network latency and outages on top of this execution response time.

### remote.call(*methodName*, *params*, *callback*)

##### Bluebird: remote.callAsync(*methodName*, *params*)

Queue a call to the other end's method `methodName` with `params` as a single argument.  Your callback is _guaranteed_ to be invoked even if the server never responds, in which case it would be in error, after a timeout.

While it is up to implementations to decide what to do with `params`: either an Array or an object (alas, no bare values per the specification).  I recommend an object so that properties can be named and future changes have less risk of breaking anything.

```js
remote._call('foo', [], function(err, result) {
  if (err) {
    // Something went wrong...
  } else {
    // 'result' was returned by the other end's exposed 'foo()'
  }
});
```

### remote.expose(*methodName*, *callback*)

Individually add declaration that `callback` as implementing `methodName` to the other end. Whenever calls from the other end will be processed, `callback` will be invoked:

```js
remote.expose('foo.bar', function(params, next) {
  return next(null, 'This is my result string');
});
```

### remote.expose(*object*)

Add many declarations at once:

```js
remote.expose({
  'foo.bar': function(params, next) { ... },
  'ping': function(params, next) { ... }
});
```

Note that since periods '.' are part of property names, you'll need to use strings as keys throughout.

### remote.receive(*message*)

Parse `message` as a JSON-RPC 2.0 request or response.  If it's a request, responses will be created and transmitted back (or queued).  If it's a response, callers will receive what they were waiting for.

### remote.transmit(*callback*)

If there is any queued up JSON-RPC to send to the other end, `callback(data,cb)` will be called to send it.  Your callback should call us back with `null` or `false` on success, `true` on error per Node convention.  (See examples in previous section.)

### remote.setTransmitter(*callback*)

Normally, JRPC doesn't know how to send data to the other end.  If you're using a polling communication model, you're probably invoking `remote.transmit()` periodically.  If you're on a fast I/O channel like WebSockets or Socket.IO, however, with this method you can tell JRPC to send messages as needed.

To stop this later, `remote.setTransmitter(null)` does the trick.

## RPC API

The `system` reserved module implements some handy introspection methods to help API users discover a server's exposed functionality.

### system.extension.dual-batch()

Cannot actually be called.  Its presence indicates support for the "dual-batch" extension to JSON-RPC 2.0 which was created for this module.  It means that this end can understand messages made up of _two_ JSON-RPC 2.0 messages combined: a batch of responses and a batch of requests.  This is very useful in saving precious round trips in long-polling scenarios where both ends may send requests or notifications.  The format is simple:

```json
{
  "responses": [],
  "requests": []
}
```

### system.listComponents([*mine*])

Like in XML-RPC, returns an object describing all exposed methods at the time it is called.  Each method name (including periods '.' treated as _regular_ characters) is paired with `true`.  Thus, in a freshly instance, it would return:

```json
{
  "system.listComponents": true,
  "system.methodHelp": true,
  "system.extension.dual-batch": true
}
```

If provided, `mine` should contain the equivalent list from this end.  This allows for both ends to discover each other's capabilities in a single round-trip, typically initiated by the end which established the communication itself.

Unlike any other method, when JRPC is handling a request or response from this call, it caches the capabilities of the other end and will use this cached information if the method is called again (or in the other direction if `mine` was provided).

Because protocol extensions are declared as exposed methods, this means that protocol upgrades are available as soon as the second half of the initial round-trip, provided it is for `system.listComponents()`.  (See the `client` option to `JRPC()` above.)

### system.methodHelp(*methodName*)
### system.methodSignature(*methodName*)

Reserved per XML-RPC, but not implemented.


## FUTURE EXTENSIONS

For time considerations, I had to put aside the idea of native bindings for this release.  The idea was to use `system.listComponents()` to discover the other end's exposed methods early and make them directly available in the `remote` instance, making this possible:

```js
remote.system.methodHelp('system.extension.dual-batch', function(err, help) {
  if (err) {
    // Unknown method, perhaps?
  } else {
    console.log('system.extension.dual-batch() usage: ' + help);
  }
});
```

This will involve breaking the API to add underscores '_' to JRPC methods (i.e. `remote._call()`) to keep them out of the way of remote calls.

Because bindings do not add _that_ much convenience however, they were excluded from this release and to keep this simpler API cleanest at the expense of future drop-in compatibility, I took away the prefix underscores.
